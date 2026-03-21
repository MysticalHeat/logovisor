# logovisor-agent deb packaging

Здесь будет лежать сборка `.deb` пакета для `logovisor-agent`.

План:

- собирать бинарь `bin/logovisor-agent`
- раскладывать `systemd` unit в `/lib/systemd/system/`
- добавлять конфиг в `/etc/logovisor/agent.yaml`
- оформлять postinst/prerm скрипты
