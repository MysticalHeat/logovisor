import argparse
import os
import random
import subprocess
import time

import yaml

from templates import (
    nginx_access,
    nginx_error,
    python_app,
    syslog_message,
    startup_message,
    bruteforce_message,
    ATTACKER_IPS,
)


def load_config(config_path):
    if not os.path.exists(config_path):
        return {
            "services": ["nginx", "python_app", "syslog"],
            "output": {"file_dir": "/var/log/generated", "journald": True},
            "rate": {"logs_per_second": 3},
            "anomaly": {
                "enabled": True,
                "normal_duration": 120,
                "anomaly_duration": 30,
            },
        }

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    return config


def setup_log_files(file_dir, services):
    files = {}

    os.makedirs(file_dir, exist_ok=True)
    files["all"] = open(os.path.join(file_dir, "all.log"), "a")

    if "nginx" in services:
        nginx_dir = os.path.join(file_dir, "nginx")
        os.makedirs(nginx_dir, exist_ok=True)
        files["nginx_access"] = open(os.path.join(nginx_dir, "access.log"), "a")
        files["nginx_error"] = open(os.path.join(nginx_dir, "error.log"), "a")

    if "python_app" in services:
        app_dir = os.path.join(file_dir, "python_app")
        os.makedirs(app_dir, exist_ok=True)
        files["python_app"] = open(os.path.join(app_dir, "app.log"), "a")

    if "syslog" in services:
        syslog_dir = os.path.join(file_dir, "syslog")
        os.makedirs(syslog_dir, exist_ok=True)
        files["syslog"] = open(os.path.join(syslog_dir, "messages.log"), "a")

    return files


def write_to_file(file_obj, line):
    file_obj.write(line + "\n")
    file_obj.flush()


def write_to_journald(message, tag="log-generator", priority="info"):
    try:
        subprocess.run(
            ["logger", "-t", tag, "-p", f"user.{priority}", message],
            check=False,
            capture_output=True,
        )
    except FileNotFoundError:
        pass


def check_journald():
    return os.path.exists("/run/systemd/journal/socket")


def get_priority_from_line(line):
    line_lower = line.lower()
    if "critical" in line_lower or "fatal" in line_lower or "killed" in line_lower:
        return "crit"
    elif "error" in line_lower or "failed" in line_lower:
        return "err"
    elif "warning" in line_lower or "warn" in line_lower:
        return "warning"
    else:
        return "info"


def generate_log_line(service, is_error=False):
    if service == "nginx_access":
        return nginx_access(is_error=is_error)
    elif service == "nginx_error":
        return nginx_error()
    elif service == "python_app":
        return python_app(is_error=is_error)
    elif service == "syslog":
        return syslog_message(is_error=is_error)
    return ""


def get_mode_params(mode, anomaly_elapsed=0, anomaly_duration=30):
    if mode == "normal":
        return {
            "error_prob": 0.05,
            "rate": random.uniform(1, 5),
        }

    elif mode == "error_spike":
        return {
            "error_prob": random.uniform(0.6, 0.8),
            "rate": random.uniform(20, 50),
        }

    elif mode == "crash":
        silence_end = anomaly_duration * 0.6
        if anomaly_elapsed < silence_end:
            return {
                "error_prob": 0,
                "rate": 0,
            }
        else:
            return {
                "error_prob": 0,
                "rate": random.uniform(5, 15),
                "startup": True,
            }

    elif mode == "degradation":
        progress = anomaly_elapsed / anomaly_duration
        error_prob = 0.05 + (0.45 * progress)
        return {
            "error_prob": error_prob,
            "rate": random.uniform(2, 8),
        }

    elif mode == "bruteforce":
        return {
            "error_prob": 0,
            "rate": random.uniform(8, 15),
            "bruteforce": True,
        }

    return {"error_prob": 0.05, "rate": random.uniform(1, 5)}


def run_generator(config, args):
    services = args.services if args.services else config["services"]
    file_dir = config["output"]["file_dir"]
    use_journald = config["output"].get("journald", True) and not args.no_journald
    base_rate = args.rate if args.rate else config["rate"]["logs_per_second"]
    anomaly_enabled = config["anomaly"]["enabled"] and args.mode is None
    normal_duration = config["anomaly"]["normal_duration"]
    anomaly_duration = config["anomaly"]["anomaly_duration"]

    journald_available = check_journald()
    if use_journald and not journald_available:
        use_journald = False

    log_files = setup_log_files(file_dir, services)

    active_outputs = []
    if "nginx" in services:
        active_outputs.append("nginx_access")
        active_outputs.append("nginx_error")
    if "python_app" in services:
        active_outputs.append("python_app")
    if "syslog" in services:
        active_outputs.append("syslog")

    if args.mode:
        current_mode = args.mode
    else:
        current_mode = "normal"

    anomaly_modes = ["error_spike", "crash", "degradation", "bruteforce"]

    mode_start_time = time.time()
    anomaly_start_time = 0
    bruteforce_ip = random.choice(ATTACKER_IPS)

    print(f"log-generator started for {file_dir}")

    try:
        while True:
            now = time.time()

            if anomaly_enabled:
                elapsed_in_mode = now - mode_start_time

                if current_mode == "normal" and elapsed_in_mode >= normal_duration:
                    current_mode = random.choice(anomaly_modes)
                    mode_start_time = now
                    anomaly_start_time = now
                    bruteforce_ip = random.choice(ATTACKER_IPS)
                    print(f"anomaly triggered: {current_mode}")

                elif current_mode != "normal" and elapsed_in_mode >= anomaly_duration:
                    current_mode = "normal"
                    mode_start_time = now

            anomaly_elapsed = now - anomaly_start_time if current_mode != "normal" else 0
            params = get_mode_params(current_mode, anomaly_elapsed, anomaly_duration)

            rate = params["rate"]

            if rate == 0:
                time.sleep(0.5)
                continue

            output = random.choice(active_outputs)
            is_error = random.random() < params.get("error_prob", 0.05)

            if params.get("startup"):
                line = startup_message()
                output = "syslog"
            elif params.get("bruteforce"):
                line = bruteforce_message(attacker_ip=bruteforce_ip)
                output = "syslog"
            elif output == "nginx_error":
                if is_error:
                    line = nginx_error()
                else:
                    line = nginx_access(is_error=False)
                    output = "nginx_access"
            else:
                line = generate_log_line(output, is_error=is_error)

            if output in log_files:
                write_to_file(log_files[output], line)

            write_to_file(log_files["all"], line)

            if use_journald:
                if output.startswith("nginx"):
                    tag = "nginx"
                elif output == "python_app":
                    tag = "python-app"
                else:
                    tag = "syslog-gen"

                priority = get_priority_from_line(line)
                write_to_journald(line, tag=tag, priority=priority)

            sleep_time = 1.0 / rate
            sleep_time = sleep_time * random.uniform(0.5, 1.5)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print("log-generator stopped")
    finally:
        for f in log_files.values():
            f.close()


def parse_args():
    parser = argparse.ArgumentParser(description="Log generator for testing")

    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--rate", type=float, default=None)
    parser.add_argument(
        "--mode",
        choices=["normal", "error_spike", "crash", "degradation", "bruteforce"],
        default=None,
    )
    parser.add_argument("--services", type=lambda s: s.split(","), default=None)
    parser.add_argument("--no-journald", action="store_true")
    parser.add_argument("--file-dir", default=None)

    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    config = load_config(args.config)

    if args.file_dir:
        config["output"]["file_dir"] = args.file_dir

    run_generator(config, args)
