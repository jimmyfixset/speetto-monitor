-- 스피또 게임 정보 테이블
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, -- 'speetto1000', 'speetto2000'
  round INTEGER NOT NULL, -- 회차 번호
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, round)
);

-- 스피또 모니터링 데이터 테이블
CREATE TABLE IF NOT EXISTS monitoring_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  as_of_date DATE NOT NULL, -- 기준 날짜
  store_instock_rate INTEGER NOT NULL, -- 출고율 (퍼센트)
  first_prize_remaining INTEGER NOT NULL, -- 1등 잔여 수량
  second_prize_remaining INTEGER NOT NULL, -- 2등 잔여 수량
  third_prize_remaining INTEGER NOT NULL, -- 3등 잔여 수량
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id)
);

-- 알림 설정 테이블 
CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL, -- 수신자 전화번호
  target_games TEXT NOT NULL, -- 모니터링할 게임 (JSON 형태: ["speetto1000", "speetto2000"])
  is_active BOOLEAN DEFAULT TRUE, -- 알림 활성화 여부
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 알림 발송 로그 테이블
CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  game_name TEXT NOT NULL,
  round INTEGER NOT NULL,
  message TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'sent' -- 'sent', 'failed'
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_games_name_round ON games(name, round);
CREATE INDEX IF NOT EXISTS idx_monitoring_data_game_id ON monitoring_data(game_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_data_date ON monitoring_data(as_of_date);
CREATE INDEX IF NOT EXISTS idx_notification_settings_active ON notification_settings(is_active);
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON notification_logs(sent_at);