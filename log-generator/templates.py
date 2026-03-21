import random
from datetime import datetime


NGINX_PATHS = [
    "/api/users", "/api/orders", "/api/auth/login", "/api/auth/logout",
    "/api/products", "/api/cart", "/api/payments", "/api/health",
    "/static/js/app.js", "/static/css/style.css", "/static/img/logo.png",
    "/", "/dashboard", "/profile", "/settings",
]

NGINX_METHODS = ["GET", "GET", "GET", "GET", "POST", "POST", "PUT", "DELETE"]

NGINX_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "curl/8.4.0",
    "python-requests/2.31.0",
]

CLIENT_IPS = [f"192.168.1.{i}" for i in range(10, 60)]
CLIENT_IPS += ["10.0.0.5", "10.0.0.12", "172.16.0.100", "203.0.113.42"]


def nginx_access(is_error=False):
    ip = random.choice(CLIENT_IPS)
    method = random.choice(NGINX_METHODS)
    path = random.choice(NGINX_PATHS)
    user_agent = random.choice(NGINX_USER_AGENTS)
    size = random.randint(200, 50000)
    now = datetime.now().strftime("%d/%b/%Y:%H:%M:%S +0000")

    if is_error:
        status = random.choice([500, 502, 503, 504, 500, 500])
        size = random.randint(50, 500)
    else:
        status = random.choice([200, 200, 200, 200, 200, 201, 301, 304, 404])

    return f'{ip} - - [{now}] "{method} {path} HTTP/1.1" {status} {size} "-" "{user_agent}"'


NGINX_ERROR_MESSAGES = [
    'connect() failed (111: Connection refused) while connecting to upstream',
    'upstream timed out (110: Connection timed out) while reading response header',
    'no live upstreams while connecting to upstream',
    'recv() failed (104: Connection reset by peer)',
    'client intended to send too large body: 10485760 bytes',
    'SSL_do_handshake() failed (SSL: error:0A000086)',
    'open() "/usr/share/nginx/html/favicon.ico" failed (2: No such file or directory)',
]

NGINX_UPSTREAM_SERVERS = [
    "http://127.0.0.1:8080", "http://127.0.0.1:8081",
    "http://app-server:3000", "http://api-backend:5000",
]


def nginx_error():
    now = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
    pid = random.randint(1, 9999)
    conn = random.randint(1000, 99999)
    error_msg = random.choice(NGINX_ERROR_MESSAGES)
    client_ip = random.choice(CLIENT_IPS)
    upstream = random.choice(NGINX_UPSTREAM_SERVERS)
    path = random.choice(NGINX_PATHS)

    return (
        f'{now} [error] {pid}#0: *{conn} {error_msg}, '
        f'client: {client_ip}, server: api.example.com, '
        f'request: "GET {path} HTTP/1.1", upstream: "{upstream}{path}"'
    )


PYTHON_MODULES = ["app.views", "app.database", "app.auth", "app.tasks", "app.cache", "app.api"]

PYTHON_INFO_MESSAGES = [
    "Request processed in {time}ms user_id={user_id}",
    "Cache hit for key=session:{user_id}",
    "Task enqueued: send_email to user_id={user_id}",
    "Database query completed in {time}ms rows={rows}",
    "User logged in successfully user_id={user_id}",
    "Health check passed all_services=ok",
    "Background job finished job_id={job_id} duration={time}ms",
    "API response sent status=200 path=/api/users/{user_id}",
]

PYTHON_WARNING_MESSAGES = [
    "Slow query detected duration={time}ms query=SELECT * FROM orders",
    "Rate limit approaching for user_id={user_id} current=95/100",
    "Connection pool running low available=2/20",
    "Retry attempt 2/3 for external API call",
    "Deprecated endpoint called: /api/v1/users by user_id={user_id}",
    "Memory usage high: {memory}MB / 512MB",
]

PYTHON_ERROR_MESSAGES = [
    "ConnectionError: Cannot connect to PostgreSQL at db-master:5432",
    "TimeoutError: Redis connection timed out after 5000ms",
    "ValueError: Invalid user_id format received: '{bad_value}'",
    "PermissionError: Access denied for user_id={user_id} resource=/admin",
    "HTTPError: External API returned 503 url=https://payment.example.com/charge",
    "IntegrityError: Duplicate key user_email=test@example.com",
    "ConnectionRefusedError: Cannot connect to RabbitMQ at mq:5672",
    "MemoryError: Cannot allocate 256MB for batch processing",
]

PYTHON_CRITICAL_MESSAGES = [
    "FATAL: Database connection pool exhausted, all 20 connections in use",
    "FATAL: Disk space critically low: 98% used on /var/lib/data",
    "FATAL: Unhandled exception in main loop, service restarting",
    "FATAL: SSL certificate expired for api.example.com",
]


def python_app(is_error=False):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ms = random.randint(0, 999)
    module = random.choice(PYTHON_MODULES)

    values = {
        "time": random.randint(1, 500),
        "user_id": random.randint(1000, 9999),
        "rows": random.randint(1, 1000),
        "job_id": random.randint(10000, 99999),
        "memory": random.randint(300, 500),
        "bad_value": random.choice(["null", "undefined", "abc", "-1", ""]),
    }

    if is_error:
        if random.random() < 0.15:
            level = "CRITICAL"
            message = random.choice(PYTHON_CRITICAL_MESSAGES)
        else:
            level = "ERROR"
            message = random.choice(PYTHON_ERROR_MESSAGES)
    else:
        if random.random() < 0.15:
            level = "WARNING"
            message = random.choice(PYTHON_WARNING_MESSAGES)
        elif random.random() < 0.05:
            level = "DEBUG"
            message = f"Processing request params={{'page': {random.randint(1, 50)}}}"
        else:
            level = "INFO"
            message = random.choice(PYTHON_INFO_MESSAGES)

    for key, value in values.items():
        message = message.replace("{" + key + "}", str(value))

    return f"{now},{ms:03d} {level:<8} [{module}] {message}"


HOSTNAME = "web-server-01"

SYSLOG_NORMAL_MESSAGES = [
    ("sshd", "Accepted publickey for deploy from 10.0.0.1 port {port} ssh2"),
    ("sshd", "session opened for user deploy by (uid=0)"),
    ("sshd", "session closed for user deploy"),
    ("systemd", "Started Session {session} of user deploy."),
    ("systemd", "Removed slice User Slice of deploy."),
    ("cron", "(root) CMD (/usr/bin/logrotate /etc/logrotate.conf)"),
    ("cron", "(root) CMD (test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily ))"),
    ("sudo", "deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/bin/systemctl restart nginx"),
    ("kernel", "[{uptime}] eth0: link up at 1000 Mbps, full duplex, flow control disabled"),
    ("systemd", "Starting Daily apt download activities..."),
    ("systemd", "Finished Daily apt download activities."),
]

SYSLOG_ERROR_MESSAGES = [
    ("sshd", "Failed password for root from {attacker_ip} port {port} ssh2"),
    ("sshd", "Failed password for invalid user admin from {attacker_ip} port {port} ssh2"),
    ("kernel", "[{uptime}] Out of memory: Killed process {pid} (python3) total-vm:2048000kB"),
    ("kernel", "[{uptime}] EXT4-fs error (device sda1): ext4_lookup: inode #12345: comm nginx: deleted inode referenced"),
    ("systemd", "nginx.service: Main process exited, code=killed, status=9/KILL"),
    ("systemd", "nginx.service: Failed with result 'signal'."),
    ("sudo", "deploy : command not allowed ; TTY=pts/0 ; PWD=/root ; USER=root ; COMMAND=/bin/rm -rf /"),
    ("kernel", "[{uptime}] TCP: request_sock_TCP: Possible SYN flooding on port 80. Sending cookies."),
]

ATTACKER_IPS = ["203.0.113.5", "198.51.100.23", "45.33.32.156", "185.220.101.42"]


def syslog_message(is_error=False):
    now = datetime.now().strftime("%b %d %H:%M:%S")

    values = {
        "port": str(random.randint(30000, 65000)),
        "session": str(random.randint(100, 9999)),
        "uptime": f"{random.randint(10000, 999999)}.{random.randint(100, 999)}",
        "pid": str(random.randint(1000, 30000)),
        "attacker_ip": random.choice(ATTACKER_IPS),
    }

    if is_error:
        service, message = random.choice(SYSLOG_ERROR_MESSAGES)
    else:
        service, message = random.choice(SYSLOG_NORMAL_MESSAGES)

    for key, value in values.items():
        message = message.replace("{" + key + "}", value)

    pid = random.randint(1000, 65000)
    return f"{now} {HOSTNAME} {service}[{pid}]: {message}"


STARTUP_MESSAGES = [
    "systemd[1]: Starting nginx.service - A high performance web server...",
    "systemd[1]: Started nginx.service - A high performance web server.",
    "nginx[{pid}]: nginx/1.24.0 started",
    "systemd[1]: Starting app.service - Python Application Server...",
    "app[{pid}]: Loading configuration from /etc/app/config.yaml",
    "app[{pid}]: Connecting to database at db-master:5432...",
    "app[{pid}]: Database connection established, pool size=20",
    "app[{pid}]: Starting HTTP server on 0.0.0.0:8080",
    "systemd[1]: Started app.service - Python Application Server.",
]


def startup_message():
    now = datetime.now().strftime("%b %d %H:%M:%S")
    pid = random.randint(1000, 30000)
    message = random.choice(STARTUP_MESSAGES)
    message = message.replace("{pid}", str(pid))
    return f"{now} {HOSTNAME} {message}"


def bruteforce_message(attacker_ip=None):
    now = datetime.now().strftime("%b %d %H:%M:%S")
    if attacker_ip is None:
        attacker_ip = random.choice(ATTACKER_IPS)

    port = random.randint(30000, 65000)
    pid = random.randint(1000, 65000)
    user = random.choice(["root", "admin", "ubuntu", "deploy", "test", "postgres", "mysql"])

    return f"{now} {HOSTNAME} sshd[{pid}]: Failed password for {user} from {attacker_ip} port {port} ssh2"


if __name__ == "__main__":
    print("=== Nginx Access Log ===")
    for i in range(5):
        print(nginx_access(is_error=False))
    for i in range(3):
        print(nginx_access(is_error=True))

    print("\n=== Nginx Error Log ===")
    for i in range(5):
        print(nginx_error())

    print("\n=== Python App Log ===")
    for i in range(5):
        print(python_app(is_error=False))
    for i in range(3):
        print(python_app(is_error=True))

    print("\n=== Syslog Messages ===")
    for i in range(5):
        print(syslog_message(is_error=False))
    for i in range(3):
        print(syslog_message(is_error=True))

    print("\n=== Startup Messages ===")
    for i in range(5):
        print(startup_message())

    print("\n=== Bruteforce Messages ===")
    for i in range(5):
        print(bruteforce_message(attacker_ip="203.0.113.5"))
