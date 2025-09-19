import { Hono } from 'hono'
import { cors } from 'hono/cors'
// import { serveStatic } from 'hono/cloudflare-workers' // 정적 파일 서빙 제거
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
      WHERE type='table' AND name IN ('games', 'monitoring_logs')
    `).all()
    
    if (tablesExist.results.length < 2) {
      console.log('데이터베이스 테이블 초기화 실행...')
      
      // migrations 스크립트 실행 (여기서는 직접 SQL 작성)
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          round INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, round)
        )`),
        
        db.prepare(`CREATE TABLE IF NOT EXISTS monitoring_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL,
          store_instock_rate REAL NOT NULL,
          first_prize_remaining INTEGER NOT NULL,
          alert_sent BOOLEAN DEFAULT FALSE,
          checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES games(id)
        )`)
      ])
      
      // 인덱스 생성
      await db.batch([
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_games_name_round ON games(name, round)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_monitoring_game_id ON monitoring_logs(game_id)`)
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

// 정적 파일 서빙 제거 - 모든 JS/CSS를 인라인으로 처리

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
            
            <div class="grid grid-cols-1 gap-6 mb-8">
                <div class="bg-white p-6 rounded-lg shadow">
                    <h2 class="text-xl font-semibold mb-4">
                        <i class="fas fa-chart-line mr-2 text-green-600"></i>
                        스피또 현재 상태
                    </h2>
                    <div class="mb-4 p-4 bg-blue-50 rounded-lg">
                        <div class="flex items-center text-blue-800">
                            <i class="fas fa-info-circle mr-2"></i>
                            <span class="text-sm">
                                <strong>자동 모니터링:</strong> 매 1시간마다 출고율 100% + 1등 잔존 시 01067790104로 SMS 발송
                            </span>
                        </div>
                    </div>
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
                    <i class="fas fa-cog mr-2 text-purple-600"></i>
                    시스템 정보
                </h2>
                <div class="text-sm text-gray-600">
                    <p>• <strong>모니터링 간격:</strong> 3시간마다 자동 체크</p>
                    <p>• <strong>알림 조건:</strong> 출고율 100% + 1등 잔여 > 0</p>
                    <p>• <strong>SMS 수신번호:</strong> 010-6779-0104</p>
                    <p>• <strong>마지막 업데이트:</strong> <span id="last-update">방금 전</span></p>
                </div>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
        // 스피또 모니터링 시스템 인라인 JavaScript
        document.addEventListener('DOMContentLoaded', function() {
            loadCurrentStatus();
        });

        async function loadCurrentStatus() {
            try {
                const response = await axios.get('/api/status');
                if (response.data.success) {
                    displayCurrentStatus(response.data.data);
                } else {
                    showError('상태 조회 실패: ' + response.data.message);
                }
            } catch (error) {
                console.error('Error loading status:', error);
                showError('상태를 불러오는 중 오류가 발생했습니다.');
            }
        }

        function displayCurrentStatus(data) {
            const statusDiv = document.getElementById('current-status');
            
            let html = '<div class="space-y-4">';
            
            Object.entries(data).forEach(([gameName, info]) => {
                const gameDisplayName = gameName === 'speetto1000' ? '스피또1000' : '스피또2000';
                const isFullStock = info.storeInstockRate >= 100;
                const hasFirstPrize = info.firstPrizeRemaining > 0;
                
                const shouldAlert = isFullStock && hasFirstPrize;
                
                html += \`
                    <div class="border rounded-lg p-4 \${shouldAlert ? 'bg-red-50 border-red-200' : 'bg-gray-50'}">
                        <div class="flex justify-between items-center mb-2">
                            <h3 class="font-semibold text-lg">\${gameDisplayName} (\${info.round}회)</h3>
                            \${shouldAlert ? '<span class="text-red-600 font-bold text-sm">🚨 알림 조건 만족!</span>' : ''}
                        </div>
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span class="text-gray-600">출고율:</span> 
                                <span class="font-semibold \${isFullStock ? 'text-red-600' : ''}">\${info.storeInstockRate}%</span>
                            </div>
                            <div>
                                <span class="text-gray-600">기준일:</span> 
                                <span class="font-semibold">\${info.asOf}</span>
                            </div>
                            <div>
                                <span class="text-gray-600">1등 잔여:</span> 
                                <span class="font-semibold \${hasFirstPrize ? 'text-green-600' : 'text-red-600'}">\${info.firstPrizeRemaining}매</span>
                            </div>
                            <div>
                                <span class="text-gray-600">2등 잔여:</span> 
                                <span class="font-semibold">\${info.secondPrizeRemaining}매</span>
                            </div>
                        </div>
                    </div>
                \`;
            });
            
            html += '</div>';
            statusDiv.innerHTML = html;
            
            // 마지막 업데이트 시간 표시
            const updateTime = document.getElementById('last-update');
            if (updateTime) {
                updateTime.textContent = new Date().toLocaleString('ko-KR');
            }
        }

        async function checkNow() {
            const checkButton = document.querySelector('button[onclick="checkNow()"]');
            checkButton.disabled = true;
            checkButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>체크 중...';
            
            try {
                const response = await axios.post('/api/check-now');
                
                if (response.data.success) {
                    showSuccess(response.data.message);
                    await loadCurrentStatus();
                } else {
                    showError(response.data.message);
                }
            } catch (error) {
                console.error('Error during check:', error);
                showError('체크 중 오류가 발생했습니다.');
            } finally {
                checkButton.disabled = false;
                checkButton.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>지금 확인';
            }
        }

        function showSuccess(message) {
            showNotification(message, 'success');
        }

        function showError(message) {
            showNotification(message, 'error');
        }

        function showNotification(message, type) {
            const existingNotification = document.querySelector('.notification');
            if (existingNotification) {
                existingNotification.remove();
            }
            
            const notification = document.createElement('div');
            notification.className = \`notification fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 \${
                type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
            }\`;
            notification.innerHTML = \`
                <div class="flex items-center">
                    <i class="fas \${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>
                    <span>\${message}</span>
                    <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            \`;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification && notification.parentNode) {
                    notification.remove();
                }
            }, 3000);
        }
        </script>
    </body>
    </html>
  `)
})

// API 라우트들
// 간단한 헬스체크 API
app.get('/api/hello', (c) => {
  return c.json({ 
    success: true, 
    message: 'Hello from 스피또 모니터링 시스템!',
    timestamp: new Date().toISOString()
  })
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
