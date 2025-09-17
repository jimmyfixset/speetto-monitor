// 스피또 모니터링 시스템 프론트엔드 JavaScript

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    loadCurrentStatus();
    loadNotificationLogs();
});

// 현재 상태 로드
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

// 현재 상태 표시
function displayCurrentStatus(data) {
    const statusDiv = document.getElementById('current-status');
    
    let html = '<div class="space-y-4">';
    
    Object.entries(data).forEach(([gameName, info]) => {
        const gameDisplayName = gameName === 'speetto1000' ? '스피또1000' : '스피또2000';
        const isFullStock = info.storeInstockRate >= 100;
        const hasFirstPrize = info.firstPrizeRemaining > 0;
        
        // 알림 조건: 출고율 100% AND 1등 잔여 있음
        const shouldAlert = isFullStock && hasFirstPrize;
        
        html += `
            <div class="border rounded-lg p-4 ${shouldAlert ? 'bg-red-50 border-red-200' : 'bg-gray-50'}">
                <div class="flex justify-between items-center mb-2">
                    <h3 class="font-semibold text-lg">${gameDisplayName} (${info.round}회)</h3>
                    ${shouldAlert ? '<span class="text-red-600 font-bold text-sm">🚨 알림 조건 만족!</span>' : ''}
                </div>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span class="text-gray-600">출고율:</span> 
                        <span class="font-semibold ${isFullStock ? 'text-red-600' : ''}">${info.storeInstockRate}%</span>
                    </div>
                    <div>
                        <span class="text-gray-600">기준일:</span> 
                        <span class="font-semibold">${info.asOf}</span>
                    </div>
                    <div>
                        <span class="text-gray-600">1등 잔여:</span> 
                        <span class="font-semibold ${hasFirstPrize ? 'text-green-600' : 'text-red-600'}">${info.firstPrizeRemaining}매</span>
                    </div>
                    <div>
                        <span class="text-gray-600">2등 잔여:</span> 
                        <span class="font-semibold">${info.secondPrizeRemaining}매</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    statusDiv.innerHTML = html;
}

// 고정 전화번호 사용으로 알림 설정 기능 제거

// 수동 체크
async function checkNow() {
    const checkButton = document.querySelector('button[onclick="checkNow()"]');
    checkButton.disabled = true;
    checkButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>체크 중...';
    
    try {
        const response = await axios.post('/api/check-now');
        
        if (response.data.success) {
            showSuccess(response.data.message);
            // 상태 새로고침
            await loadCurrentStatus();
            await loadNotificationLogs();
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

// 알림 로그 로드
async function loadNotificationLogs() {
    try {
        const response = await axios.get('/api/notification-logs');
        if (response.data.success) {
            displayNotificationLogs(response.data.data);
        } else {
            document.getElementById('notification-logs').innerHTML = 
                '<p class="text-red-600">로그를 불러올 수 없습니다.</p>';
        }
    } catch (error) {
        console.error('Error loading logs:', error);
        document.getElementById('notification-logs').innerHTML = 
            '<p class="text-red-600">로그를 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 알림 로그 표시
function displayNotificationLogs(logs) {
    const logsDiv = document.getElementById('notification-logs');
    
    if (logs.length === 0) {
        logsDiv.innerHTML = '<p class="text-gray-600">아직 발송된 알림이 없습니다.</p>';
        return;
    }
    
    let html = '<div class="space-y-2 max-h-64 overflow-y-auto">';
    
    logs.forEach(log => {
        const date = new Date(log.sent_at).toLocaleString('ko-KR');
        const gameDisplayName = log.game_name === 'speetto1000' ? '스피또1000' : '스피또2000';
        const statusColor = log.status === 'sent' ? 'text-green-600' : 'text-red-600';
        
        html += `
            <div class="border border-gray-200 rounded p-3 bg-gray-50">
                <div class="flex justify-between items-start mb-1">
                    <span class="font-medium">${gameDisplayName} ${log.round}회</span>
                    <span class="${statusColor} text-sm">${log.status === 'sent' ? '발송완료' : '발송실패'}</span>
                </div>
                <p class="text-sm text-gray-700 mb-1">${log.message}</p>
                <p class="text-xs text-gray-500">${date}</p>
            </div>
        `;
    });
    
    html += '</div>';
    logsDiv.innerHTML = html;
}

// 성공 메시지 표시
function showSuccess(message) {
    showNotification(message, 'success');
}

// 오류 메시지 표시
function showError(message) {
    showNotification(message, 'error');
}

// 알림 메시지 표시
function showNotification(message, type) {
    // 기존 알림 제거
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `notification fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
        type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
    }`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // 3초 후 자동 제거
    setTimeout(() => {
        if (notification && notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// 주기적으로 상태 업데이트 (5분마다) - 실제 자동 모니터링은 1시간마다 서버에서 실행
setInterval(loadCurrentStatus, 5 * 60 * 1000);