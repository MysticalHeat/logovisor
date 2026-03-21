FROM python:3.11-slim

# logger нужен для записи в journald
RUN apt-get update && apt-get install -y bsdutils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY log-generator/config.yaml log-generator/generator.py log-generator/templates.py ./

RUN pip install pyyaml

CMD ["python", "generator.py"]
