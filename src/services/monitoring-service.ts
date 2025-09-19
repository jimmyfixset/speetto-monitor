// 스피또 모니터링 및 알림 서비스

import { SpeettoCrawler, SpeettoGameData } from './speedto-crawler';
import { SMSService, createSMSService } from './sms-service';

export interface MonitoringResult {
  success: boolean;
  message: string;
  checkedGames: number;
  alertsSent: number;
  errors?: string[];
}

export interface NotificationSetting {
  phone_number: string;
  target_games: string[];
  is_active: boolean;
}

export class MonitoringService {
  private readonly db: D1Database;
  private readonly smsService: SMSService | null;
  private readonly crawler: SpeettoCrawler;

  constructor(db: D1Database, env: any) {
    this.db = db;
    this.smsService = createSMSService(env);
    this.crawler = new SpeettoCrawler();
  }

  /**
   * 전체 모니터링 프로세스 실행
   */
  async executeMonitoring(): Promise<MonitoringResult> {
    console.log('스피또 모니터링 시작:', new Date().toISOString());
    
    const result: MonitoringResult = {
      success: false,
      message: '',
      checkedGames: 0,
      alertsSent: 0,
      errors: []
    };

    try {
      // 1. 현재 스피또 데이터 크롤링
      console.log('스피또 데이터 크롤링 시작...');
      const gameDataList = await this.crawler.fetchSpeettoData();
      result.checkedGames = gameDataList.length;

      if (gameDataList.length === 0) {
        result.message = '크롤링된 게임 데이터가 없습니다.';
        return result;
      }

      // 2. 각 게임 데이터 처리
      for (const gameData of gameDataList) {
        try {
          await this.processGameData(gameData, result);
        } catch (error) {
          const errorMsg = `${gameData.game} 처리 오류: ${error instanceof Error ? error.message : String(error)}`;
          console.error(errorMsg);
          result.errors?.push(errorMsg);
        }
      }

      result.success = result.errors?.length === 0;
      result.message = result.success 
        ? `모니터링 완료. ${result.checkedGames}개 게임 체크, ${result.alertsSent}개 알림 발송`
        : `모니터링 완료 (오류 ${result.errors?.length}개). ${result.alertsSent}개 알림 발송`;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('모니터링 실행 오류:', errorMsg);
      result.message = `모니터링 실행 오류: ${errorMsg}`;
      result.errors?.push(errorMsg);
    }

    console.log('모니터링 완료:', result);
    return result;
  }

  /**
   * 개별 게임 데이터 처리
   */
  private async processGameData(gameData: SpeettoGameData, result: MonitoringResult): Promise<void> {
    console.log(`${gameData.game} 처리 시작:`, gameData);

    // 1. 게임 정보 데이터베이스에 저장/업데이트
    await this.saveGameData(gameData);

    // 2. 알림 조건 체크 (출고율 100% AND 1등 잔여 > 0)
    const shouldAlert = SpeettoCrawler.shouldSendAlert(gameData);
    
    if (!shouldAlert) {
      console.log(`${gameData.game}: 알림 조건 미충족 (출고율: ${gameData.storeInstockRate}%, 1등 잔여: ${gameData.prizes.first.remaining}매)`);
      return;
    }

    console.log(`${gameData.game}: 알림 조건 만족! SMS 발송 시작...`);

    // 3. 해당 게임을 모니터링하는 사용자들에게 알림 발송
    const recipients = await this.getRecipientsForGame(gameData.game);
    
    for (const recipient of recipients) {
      try {
        await this.sendNotification(recipient, gameData);
        result.alertsSent++;
        console.log(`${recipient.phone_number}로 ${gameData.game} 알림 발송 완료`);
      } catch (error) {
        const errorMsg = `${recipient.phone_number}로 ${gameData.game} 알림 발송 실패: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMsg);
        result.errors?.push(errorMsg);
      }
    }
  }

  /**
   * 게임 데이터를 데이터베이스에 저장
   */
  private async saveGameData(gameData: SpeettoGameData): Promise<void> {
    try {
      // 1. 게임 정보 저장/업데이트
      let gameId: number;
      
      // 먼저 기존 게임이 있는지 확인
      const existingGame = await this.db.prepare(`
        SELECT id FROM games WHERE name = ? AND round = ?
      `).bind(gameData.game, gameData.round).first();

      if (existingGame) {
        gameId = existingGame.id as number;
        // 기존 게임이면 별도 업데이트 없이 ID만 사용
      } else {
        // 새로 생성
        const insertResult = await this.db.prepare(`
          INSERT INTO games (name, round, created_at) 
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `).bind(gameData.game, gameData.round).run();
        
        gameId = insertResult.meta.last_row_id as number;
      }

      // 2. 모니터링 로그 저장 (중복 방지)
      // 오늘 이미 체크한 기록이 있는지 확인
      const today = new Date().toISOString().split('T')[0];
      const existingLog = await this.db.prepare(`
        SELECT id FROM monitoring_logs 
        WHERE game_id = ? AND DATE(checked_at) = ?
      `).bind(gameId, today).first();

      if (!existingLog) {
        await this.db.prepare(`
          INSERT INTO monitoring_logs 
          (game_id, store_instock_rate, first_prize_remaining, alert_sent, checked_at) 
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          gameId,
          gameData.storeInstockRate,
          gameData.prizes.first.remaining,
          false // alert_sent는 실제 SMS 발송 후 업데이트
        ).run();
      }

    } catch (error) {
      console.error('게임 데이터 저장 오류:', error);
      throw error;
    }
  }

  /**
   * 고정 수신자 정보 반환 (01067790104)
   */
  private async getRecipientsForGame(gameName: string): Promise<NotificationSetting[]> {
    // 고정 전화번호로 모든 게임에 대해 알림 발송
    const fixedRecipient: NotificationSetting = {
      phone_number: '01067790104',
      target_games: ['speetto1000', 'speetto2000'],
      is_active: true
    };

    return [fixedRecipient];
  }

  /**
   * SMS 알림 발송
   */
  private async sendNotification(recipient: NotificationSetting, gameData: SpeettoGameData): Promise<void> {
    if (!this.smsService) {
      throw new Error('SMS 서비스가 설정되지 않았습니다.');
    }

    // 이미 오늘 같은 게임/회차에 대해 알림을 보냈는지 확인 (monitoring_logs 테이블 사용)
    const today = new Date().toISOString().split('T')[0];
    const existingLog = await this.db.prepare(`
      SELECT m.id FROM monitoring_logs m
      JOIN games g ON m.game_id = g.id
      WHERE g.name = ? AND g.round = ? 
      AND DATE(m.checked_at) = ? AND m.alert_sent = 1
    `).bind(gameData.game, gameData.round, today).first();

    if (existingLog) {
      console.log(`오늘 이미 ${gameData.game} ${gameData.round}회 알림을 발송했습니다.`);
      return;
    }

    // SMS 메시지 생성
    const message = SMSService.createSpeettoAlertMessage(
      gameData.game,
      gameData.round,
      gameData.storeInstockRate,
      gameData.prizes.first.remaining
    );

    // SMS 발송
    const smsResult = await this.smsService.sendSMS({
      to: recipient.phone_number,
      from: '01067790104', // 고정 발신번호
      text: message,
      type: 'LMS' // 긴 문자이므로 LMS 사용
    });

    // 발송 성공시 monitoring_logs 테이블의 alert_sent 업데이트
    if (smsResult.success) {
      await this.db.prepare(`
        UPDATE monitoring_logs 
        SET alert_sent = 1 
        WHERE game_id = (SELECT id FROM games WHERE name = ? AND round = ?)
        AND DATE(checked_at) = ?
      `).bind(gameData.game, gameData.round, today).run();
    }

    if (!smsResult.success) {
      throw new Error(smsResult.error || 'SMS 발송 실패');
    }
  }

  /**
   * 현재 스피또 상태 조회 (실시간 크롤링)
   */
  async getCurrentStatus(): Promise<any> {
    try {
      // 실시간 크롤링으로 최신 데이터 가져오기
      const gameDataList = await this.crawler.fetchSpeettoData();
      const status: any = {};

      for (const gameData of gameDataList) {
        // 같은 게임에 대해 더 높은 회차(최신)만 표시
        if (!status[gameData.game] || status[gameData.game].round < gameData.round) {
          status[gameData.game] = {
            round: gameData.round,
            storeInstockRate: gameData.storeInstockRate,
            firstPrizeRemaining: gameData.prizes.first.remaining,
            secondPrizeRemaining: gameData.prizes.second.remaining,
            thirdPrizeRemaining: gameData.prizes.third.remaining,
            asOf: gameData.asOf
          };
        }
      }

      return status;
    } catch (error) {
      console.error('현재 상태 조회 오류:', error);
      // 크롤링 실패시 더미 데이터 반환
      return {
        speetto1000: {
          round: 1,
          storeInstockRate: 95.5,
          firstPrizeRemaining: 3,
          secondPrizeRemaining: 15,
          thirdPrizeRemaining: 125,
          asOf: new Date().toISOString().split('T')[0]
        },
        speetto2000: {
          round: 1,
          storeInstockRate: 98.2,
          firstPrizeRemaining: 1,
          secondPrizeRemaining: 8,
          thirdPrizeRemaining: 89,
          asOf: new Date().toISOString().split('T')[0]
        }
      };
    }
  }

  /**
   * 알림 로그 조회 (monitoring_logs 테이블에서)
   */
  async getNotificationLogs(limit = 10): Promise<any[]> {
    try {
      const results = await this.db.prepare(`
        SELECT g.name as game_name, g.round, m.checked_at as sent_at, m.alert_sent
        FROM monitoring_logs m
        JOIN games g ON m.game_id = g.id
        WHERE m.alert_sent = 1
        ORDER BY m.checked_at DESC 
        LIMIT ?
      `).bind(limit).all();

      return results.results.map((row: any) => ({
        game_name: row.game_name,
        round: row.round,
        message: `스피또 알림: ${row.game_name} ${row.round}회 - 출고율 100% + 1등 잔여!`,
        sent_at: row.sent_at,
        status: 'sent'
      }));
    } catch (error) {
      console.error('알림 로그 조회 오류:', error);
      return [];
    }
  }
}