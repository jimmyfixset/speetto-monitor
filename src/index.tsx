import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { MonitoringService } from './services/monitoring-service'

type Bindings = {
  DB: D1Database;
  SOLAPI_API_KEY?: string;
  SOLAPI_SECRET_KEY?: string;
}

type Variables = {}

// Cloudflare Cron Trigger 이벤트 핸들러
const handleCronTrigger = async (event: any, env: Bindings, ctx: any) => {
  console.log('Cron 트리거 시작:', new Date().toISOString())
  
  try {
    // 데이터베이스 새로고침 및 초기화
    await initializeDatabase(env.DB)
    
    // 모니터링 서비스 실행
    const monitoringService = new MonitoringService(env.DB, env)
    const result = await monitoringService.executeMonitoring()
    
    console.log('Cron 모니터링 결과:', result)
    
    if (!result.success && result.errors && result.errors.length > 0) {
      // 오류가 있어도 부분적 성공 가능
      console.warn('Cron 모니터링 경고:', result.errors)
    }
    
  } catch (error) {
    console.error('Cron 트리거 오류:', error)
    throw error // Cloudflare에 오류 상태 전달
  }
}

// 데이터베이스 초기화 함수
const initializeDatabase = async (db: D1Database) => {
  try {
    // 기본 테이블들이 있는지 확인
    const tablesExist = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('games', 'monitoring_data', 'notification_settings', 'notification_logs')
    `).all()
    
    if (tablesExist.results.length < 4) {
      console.log('데이터베이스 테이블 초기화 실행...')
      
      // migrations 스크립트 실행 (여기서는 직접 SQL 작성)
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          round INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, round)
        )`),
        
        db.prepare(`CREATE TABLE IF NOT EXISTS monitoring_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL,
          as_of_date DATE NOT NULL,
          store_instock_rate INTEGER NOT NULL,
          first_prize_remaining INTEGER NOT NULL,
          second_prize_remaining INTEGER NOT NULL,
          third_prize_remaining INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES games(id)
        )`),
        
        db.prepare(`CREATE TABLE IF NOT EXISTS notification_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT NOT NULL,
          target_games TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`),
        
        db.prepare(`CREATE TABLE IF NOT EXISTS notification_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT NOT NULL,
          game_name TEXT NOT NULL,
          round INTEGER NOT NULL,
          message TEXT NOT NULL,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'sent'
        )`)
      ])
      
      console.log('데이터베이스 초기화 완료')
    }
  } catch (error) {
    console.error('데이터베이스 초기화 오류:', error)
    // 초기화 오류는 치명적이지 않을 수 있으므로 경고만 출력
  }
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 서빙
app.use('/static/*', serveStatic({ root: './public' }))

// 메인 페이지
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>스피또 모니터링 시스템</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 p-8">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-3xl font-bold text-gray-800 mb-6">
                <i class="fas fa-ticket-alt mr-2 text-yellow-600"></i>
                스피또 모니터링 시스템
            </h1>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div class="bg-white p-6 rounded-lg shadow">
                    <h2 class="text-xl font-semibold mb-4">
                        <i class="fas fa-bell mr-2 text-blue-600"></i>
                        알림 설정
                    </h2>
                    <div id="notification-form">
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 mb-2">전화번호</label>
                            <input type="text" id="phone-number" placeholder="010-1234-5678" 
                                   class="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 mb-2">모니터링할 게임</label>
                            <div class="space-y-2">
                                <label class="flex items-center">
                                    <input type="checkbox" id="speetto1000" value="speetto1000" class="mr-2">
                                    <span>스피또1000</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" id="speetto2000" value="speetto2000" class="mr-2">
                                    <span>스피또2000</span>
                                </label>
                            </div>
                        </div>
                        <button onclick="saveNotificationSettings()" 
                                class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700">
                            알림 설정 저장
                        </button>
                    </div>
                </div>
                
                <div class="bg-white p-6 rounded-lg shadow">
                    <h2 class="text-xl font-semibold mb-4">
                        <i class="fas fa-chart-line mr-2 text-green-600"></i>
                        현재 상태
                    </h2>
                    <div id="current-status">
                        <p class="text-gray-600">데이터를 불러오는 중...</p>
                    </div>
                    <button onclick="checkNow()" 
                            class="mt-4 w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700">
                        <i class="fas fa-sync-alt mr-2"></i>
                        지금 확인
                    </button>
                </div>
            </div>
            
            <div class="bg-white p-6 rounded-lg shadow">
                <h2 class="text-xl font-semibold mb-4">
                    <i class="fas fa-history mr-2 text-purple-600"></i>
                    최근 알림 로그
                </h2>
                <div id="notification-logs">
                    <p class="text-gray-600">로그를 불러오는 중...</p>
                </div>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

// API 라우트들
app.post('/api/notification-settings', async (c) => {
  const { env } = c
  const { phoneNumber, targetGames } = await c.req.json()
  
  try {
    // 기존 설정이 있는지 확인
    const existing = await env.DB.prepare(`
      SELECT id FROM notification_settings WHERE phone_number = ?
    `).bind(phoneNumber).first()
    
    if (existing) {
      // 업데이트
      await env.DB.prepare(`
        UPDATE notification_settings 
        SET target_games = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE phone_number = ?
      `).bind(JSON.stringify(targetGames), phoneNumber).run()
    } else {
      // 새로 생성
      await env.DB.prepare(`
        INSERT INTO notification_settings (phone_number, target_games) 
        VALUES (?, ?)
      `).bind(phoneNumber, JSON.stringify(targetGames)).run()
    }
    
    return c.json({ success: true, message: '알림 설정이 저장되었습니다.' })
  } catch (error) {
    console.error('Error saving notification settings:', error)
    return c.json({ success: false, message: '설정 저장 중 오류가 발생했습니다.' }, 500)
  }
})

// 현재 스피또 상태 조회
app.get('/api/status', async (c) => {
  const { env } = c
  
  try {
    const monitoringService = new MonitoringService(env.DB, env)
    const status = await monitoringService.getCurrentStatus()
    
    return c.json({ success: true, data: status })
  } catch (error) {
    console.error('Error fetching status:', error)
    return c.json({ success: false, message: '상태 조회 중 오류가 발생했습니다.' }, 500)
  }
})

// 수동 체크 요청
app.post('/api/check-now', async (c) => {
  const { env } = c
  
  try {
    const monitoringService = new MonitoringService(env.DB, env)
    const result = await monitoringService.executeMonitoring()
    
    return c.json({ 
      success: result.success, 
      message: result.message,
      details: {
        checkedGames: result.checkedGames,
        alertsSent: result.alertsSent,
        errors: result.errors
      }
    })
  } catch (error) {
    console.error('Error during manual check:', error)
    return c.json({ success: false, message: '체크 중 오류가 발생했습니다.' }, 500)
  }
})

// 알림 로그 조회
app.get('/api/notification-logs', async (c) => {
  const { env } = c
  
  try {
    const monitoringService = new MonitoringService(env.DB, env)
    const logs = await monitoringService.getNotificationLogs(10)
    
    return c.json({ success: true, data: logs })
  } catch (error) {
    console.error('Error fetching logs:', error)
    return c.json({ success: false, message: '로그 조회 중 오류가 발생했습니다.' }, 500)
  }
})

// Cron 이벤트 핸들러 등록
app.get('/api/cron-trigger', async (c) => {
  // 수동으로 Cron 트리거를 테스트할 때 사용
  const { env } = c
  
  try {
    await handleCronTrigger({}, env, {})
    return c.json({ success: true, message: 'Cron 트리거 수동 실행 완료' })
  } catch (error) {
    console.error('Cron 트리거 수동 실행 오류:', error)
    return c.json({ 
      success: false, 
      message: 'Cron 트리거 수동 실행 오류: ' + (error instanceof Error ? error.message : String(error))
    }, 500)
  }
})

// Cloudflare Workers 내장 이벤트 핸들러
const worker = {
  fetch: app.fetch,
  // Cron Trigger 이벤트
  scheduled: handleCronTrigger
}

export default worker
