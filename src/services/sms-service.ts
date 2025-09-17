// SMS 발송 서비스 (SOLAPI 사용)

export interface SMSConfig {
  apiKey: string;
  secretKey: string;
}

export interface SMSMessage {
  to: string;
  from: string;
  text: string;
  type?: 'SMS' | 'LMS' | 'MMS';
}

export interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SMSService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.solapi.com';
  private readonly defaultFrom = '01067790104'; // 발신번호 (동일 번호 사용)

  constructor(config: SMSConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
  }

  /**
   * SMS 메시지 발송
   */
  async sendSMS(message: SMSMessage): Promise<SMSResponse> {
    try {
      const messageData = {
        message: {
          to: this.formatPhoneNumber(message.to),
          from: message.from || this.defaultFrom,
          text: message.text,
          type: message.type || 'SMS'
        }
      };

      const response = await this.makeAPICall('/messages/v4/send', 'POST', messageData);
      
      if (response.statusCode === '2000') {
        return {
          success: true,
          messageId: response.messageId
        };
      } else {
        return {
          success: false,
          error: response.statusMessage || 'SMS 발송 실패'
        };
      }
    } catch (error) {
      console.error('SMS 발송 오류:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SMS 발송 중 알 수 없는 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 스피또 알림 메시지 생성
   */
  static createSpeettoAlertMessage(gameName: string, round: number, storeInstockRate: number, firstPrizeRemaining: number): string {
    const gameDisplayName = gameName === 'speetto1000' ? '스피또1000' : '스피또2000';
    
    return `🚨 스피또 알림 🚨\n\n` +
           `${gameDisplayName} ${round}회\n` +
           `📊 출고율: ${storeInstockRate}%\n` +
           `🎰 1등 잔여: ${firstPrizeRemaining}매\n\n` +
           `출고율 100%에 1등이 남아있습니다!\n` +
           `지금이 구매 기회입니다! 🍀\n\n` +
           `시간: ${new Date().toLocaleString('ko-KR')}`;
  }

  /**
   * 전화번호 형식 정리 (010-1234-5678 -> 01012345678)
   */
  private formatPhoneNumber(phoneNumber: string): string {
    return phoneNumber.replace(/[^0-9]/g, '');
  }

  /**
   * SOLAPI API 호출
   */
  private async makeAPICall(endpoint: string, method: 'GET' | 'POST', data?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const timestamp = new Date().getTime().toString();
    const salt = this.generateSalt();
    const signature = this.generateSignature(method, endpoint, timestamp, salt, data);

    const headers: Record<string, string> = {
      'Authorization': `HMAC-SHA256 apiKey=${this.apiKey}, date=${timestamp}, salt=${salt}, signature=${signature}`,
      'Content-Type': 'application/json'
    };

    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (method === 'POST' && data) {
      requestOptions.body = JSON.stringify(data);
    }

    const response = await fetch(url, requestOptions);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * HMAC-SHA256 서명 생성
   */
  private generateSignature(method: string, endpoint: string, timestamp: string, salt: string, data?: any): string {
    let message = `${method}${endpoint}${timestamp}${salt}`;
    
    if (method === 'POST' && data) {
      message += JSON.stringify(data);
    }

    // Cloudflare Workers 환경에서는 crypto.subtle 사용
    return this.hmacSha256(this.secretKey, message);
  }

  /**
   * HMAC-SHA256 해시 생성 (Cloudflare Workers 환경용)
   */
  private async hmacSha256(key: string, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const messageData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 랜덤 salt 생성
   */
  private generateSalt(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  /**
   * SMS 발송 가능 여부 체크 (API 키 유효성 등)
   */
  async validateConfig(): Promise<boolean> {
    try {
      // 잔액 조회로 API 키 유효성 검증
      await this.makeAPICall('/cash/v1/balance', 'GET');
      return true;
    } catch (error) {
      console.error('SMS 설정 검증 실패:', error);
      return false;
    }
  }
}

/**
 * SMS 서비스 팩토리 함수
 */
export function createSMSService(env: any): SMSService | null {
  const apiKey = env.SOLAPI_API_KEY;
  const secretKey = env.SOLAPI_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.warn('SOLAPI API 키가 설정되지 않았습니다.');
    return null;
  }

  return new SMSService({ apiKey, secretKey });
}