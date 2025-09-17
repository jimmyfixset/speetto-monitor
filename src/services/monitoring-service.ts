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
      await this.db.prepare(`
        INSERT OR REPLACE INTO games (name, round, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(gameData.game, gameData.round).run();

      const gameResult = await this.db.prepare(`
        SELECT id FROM games WHERE name = ? AND round = ?
      `).bind(gameData.game, gameData.round).first();

      if (!gameResult) {
        throw new Error('게임 정보 저장 실패');
      }

      // 2. 모니터링 데이터 저장
      await this.db.prepare(`
        INSERT OR REPLACE INTO monitoring_data 
        (game_id, as_of_date, store_instock_rate, first_prize_remaining, 
         second_prize_remaining, third_prize_remaining, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        gameResult.id,
        gameData.asOf,
        gameData.storeInstockRate,
        gameData.prizes.first.remaining,
        gameData.prizes.second.remaining,
        gameData.prizes.third.remaining
      ).run();

    } catch (error) {
      console.error('게임 데이터 저장 오류:', error);
      throw error;
    }
  }

  /**
   * 특정 게임을 모니터링하는 사용자 목록 조회
   */
  private async getRecipientsForGame(gameName: string): Promise<NotificationSetting[]> {
    try {
      const results = await this.db.prepare(`
        SELECT phone_number, target_games, is_active 
        FROM notification_settings 
        WHERE is_active = 1
      `).all();

      const recipients: NotificationSetting[] = [];

      for (const row of results.results) {
        try {
          const targetGames = JSON.parse(row.target_games as string);
          if (targetGames.includes(gameName)) {
            recipients.push({
              phone_number: row.phone_number as string,
              target_games: targetGames,
              is_active: row.is_active as boolean
            });
          }
        } catch (parseError) {
          console.error('target_games 파싱 오류:', parseError, row);
        }
      }

      return recipients;
    } catch (error) {
      console.error('수신자 목록 조회 오류:', error);
      return [];
    }
  }

  /**
   * SMS 알림 발송
   */
  private async sendNotification(recipient: NotificationSetting, gameData: SpeettoGameData): Promise<void> {
    if (!this.smsService) {
      throw new Error('SMS 서비스가 설정되지 않았습니다.');
    }

    // 이미 오늘 같은 게임/회차에 대해 알림을 보냈는지 확인
    const today = new Date().toISOString().split('T')[0];
    const existingLog = await this.db.prepare(`
      SELECT id FROM notification_logs 
      WHERE phone_number = ? AND game_name = ? AND round = ? 
      AND DATE(sent_at) = ? AND status = 'sent'
    `).bind(recipient.phone_number, gameData.game, gameData.round, today).first();

    if (existingLog) {
      console.log(`${recipient.phone_number}에게 오늘 이미 ${gameData.game} ${gameData.round}회 알림을 발송했습니다.`);
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
      from: '01012345678', // 실제 발신번호로 변경 필요
      text: message,
      type: 'LMS' // 긴 문자이므로 LMS 사용
    });

    // 발송 로그 저장
    await this.db.prepare(`
      INSERT INTO notification_logs (phone_number, game_name, round, message, sent_at, status) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).bind(
      recipient.phone_number,
      gameData.game,
      gameData.round,
      message,
      smsResult.success ? 'sent' : 'failed'
    ).run();

    if (!smsResult.success) {
      throw new Error(smsResult.error || 'SMS 발송 실패');
    }
  }

  /**
   * 현재 스피또 상태 조회 (데이터베이스에서)
   */
  async getCurrentStatus(): Promise<any> {
    try {
      const results = await this.db.prepare(`
        SELECT g.name, g.round, m.as_of_date, m.store_instock_rate, 
               m.first_prize_remaining, m.second_prize_remaining, m.third_prize_remaining
        FROM games g
        JOIN monitoring_data m ON g.id = m.game_id
        WHERE g.name IN ('speetto1000', 'speetto2000')
        ORDER BY g.name, m.created_at DESC
      `).all();

      const status: any = {};

      for (const row of results.results) {
        const gameName = row.name as string;
        if (!status[gameName]) {
          status[gameName] = {
            round: row.round,
            storeInstockRate: row.store_instock_rate,
            firstPrizeRemaining: row.first_prize_remaining,
            secondPrizeRemaining: row.second_prize_remaining,
            thirdPrizeRemaining: row.third_prize_remaining,
            asOf: row.as_of_date
          };
        }
      }

      return status;
    } catch (error) {
      console.error('현재 상태 조회 오류:', error);
      throw error;
    }
  }

  /**
   * 알림 로그 조회
   */
  async getNotificationLogs(limit = 10): Promise<any[]> {
    try {
      const results = await this.db.prepare(`
        SELECT game_name, round, message, sent_at, status 
        FROM notification_logs 
        ORDER BY sent_at DESC 
        LIMIT ?
      `).bind(limit).all();

      return results.results;
    } catch (error) {
      console.error('알림 로그 조회 오류:', error);
      return [];
    }
  }
}