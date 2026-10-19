# Craftynos

Aternos-artige Weboberfläche **neben** [Crafty Controller](https://craftycontrol.com). Craftynos ist kein eigener Server-Manager, sondern eine Oberfläche:

- **Volumes (Pflicht):** Server, Spieler, Whitelist, Properties, Dateien und Backups werden direkt über die gemeinsamen Docker-Volumes gelesen und bearbeitet. Das funktioniert ohne API-Token.
- **Crafty-API (optional):** Zusätzlich für Start/Stop/Neustart, Konsole und Live-Status (Spieler online, CPU, RAM).

> ⚠️ Es gibt noch **keinen Login**. Craftynos nicht ungeschützt ins Internet stellen (nur LAN oder hinter Reverse-Proxy mit Auth).

## Funktionen

- Serverliste mit Status, Spielerzahl, Version und Port
- Server-Übersicht mit Konsole (mit API live und mit Befehlen, ohne API aus `logs/latest.log`)
- **Spieler & Inventar:** Inventar inkl. Rüstung und Endertruhe, Leben/Hunger/Level, Position, Respawn, letzter Tod, Statistiken (aus `playerdata/*.dat` und `stats/*.json`)
- **Whitelist:** hinzufügen/entfernen (live per Konsole, sonst direkt `whitelist.json`)
- **server.properties:** Karten für die wichtigsten Optionen, alle weiteren unter „Erweitert“
- **Dateimanager:** durchsuchen, bearbeiten, hoch-/herunterladen, löschen
- **Backups:** immer **nur der World-Ordner** (`level-name`) als **ZIP**, erstellt von Craftynos selbst und abgelegt im Crafty-Backup-Ordner des Servers. Läuft der Server und ist die API verfügbar, wird vorher `save-off` / `save-all flush` ausgeführt (danach `save-on`).
  - **Dateiname einstellbar** (Einstellungen → Backups), Standard: `{server} {date} {time}` → `Survival 2026-10-19 14-30-05.zip` (Leerzeichen, Uhrzeit ohne Doppelpunkt; Doppelpunkte werden immer entfernt). Platzhalter: `{server} {world} {date} {time} {YYYY} {MM} {DD} {HH} {mm} {ss}`.
  - **Zusätzliche Ziele** in der Oberfläche: lokaler Ordner / NAS-Mount, Nextcloud (WebDAV), SFTP – optional mit automatischer Kopie neuer Backups.

**Noch nicht gebaut (kommt zum Schluss):** Webhooks und Discord-Bot-Integration, Login.

## Installation (Docker)

1. In deine bestehende Crafty-`docker-compose.yml` den Service `craftynos` einfügen (siehe unten bzw. [`docker-compose.example.yml`](docker-compose.example.yml)).
2. **Wichtig:** `/crafty/servers`, `/crafty/backups` und `/crafty/logs` müssen auf dieselben Host-Ordner zeigen und **mit denselben Containerpfaden** wie bei Crafty gemountet sein. Dann stimmen die von Crafty gemeldeten Pfade direkt.
3. `docker compose up -d` und `http://<host>:8080` öffnen. Die Server erscheinen auch ohne Token.
4. Optional: unter *Einstellungen → Verbindung* URL und API-Token von Crafty eintragen (Token in Crafty unter *Benutzer → API-Schlüssel*). Dort kann die Verbindung vorher getestet werden. Eingaben in der Oberfläche haben **Vorrang** vor `CRAFTY_URL`/`CRAFTY_API_TOKEN` aus der Compose.

### Beispiel: Crafty + Craftynos in einer Compose

```yaml
services:
    crafty:
        container_name: crafty_container
        image: registry.gitlab.com/crafty-controller/crafty-4:latest
        restart: always

        environment:
            TZ: Europe/Berlin

        ports:
            - "8443:8443"                    # Crafty HTTPS
            - "8123:8123"                    # Dynmap
            - "19132:19132/udp"              # Bedrock
            - "24454:24454/udp"              # Simple Voice Chat
            - "25500-25600:25500-25600"      # Minecraft Server Ports

        volumes:
            - /srv/docker/crafty-4/backups:/crafty/backups
            - /srv/docker/crafty-4/logs:/crafty/logs
            - /srv/docker/crafty-4/servers:/crafty/servers
            - /srv/docker/crafty-4/config:/crafty/app/config
            - /srv/docker/crafty-4/import:/crafty/import

    # Neu: Craftynos
    craftynos:
        container_name: craftynos
        image: ghcr.io/tammo2701/craftynos:latest
        restart: always
        depends_on:
            - crafty

        environment:
            TZ: Europe/Berlin
            # Optional (nur für Start/Stop/Neustart/Konsole):
            # CRAFTY_URL: https://crafty:8443
            # CRAFTY_API_TOKEN: HIER_DEN_API_TOKEN_AUS_CRAFTY

        ports:
            - "8080:8080"                    # Craftynos Weboberfläche

        volumes:
            # Dieselben Host-Ordner und Containerpfade wie bei Crafty
            - /srv/docker/crafty-4/backups:/crafty/backups
            - /srv/docker/crafty-4/logs:/crafty/logs
            - /srv/docker/crafty-4/servers:/crafty/servers
            # Optional, empfohlen: Crafty-Datenbank (nur lesend) für die echten Servernamen
            - /srv/docker/crafty-4/config:/crafty/app/config
            # Eigene Einstellungen (Backup-Ziele, Format)
            - /srv/docker/craftynos:/data
            # Optional: auf dem Host gemountetes NAS als lokales Backup-Ziel
            # - /mnt/nas/minecraft:/mnt/nas
```

Die `TZ`-Variable bestimmt die Uhrzeit in den Backup-Dateinamen. Der Hostname `crafty` in `CRAFTY_URL` ist der Service-Name derselben Compose; bei getrennten Composes die Host-IP verwenden.

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `CRAFTY_URL` | `https://crafty:8443` | Adresse der Crafty-API (Oberfläche hat Vorrang) |
| `CRAFTY_API_TOKEN` | – | API-Token (Oberfläche hat Vorrang) |
| `CRAFTY_INSECURE_TLS` | `true` | Selbstsigniertes Crafty-Zertifikat akzeptieren |
| `CRAFTY_ROOT` | `/crafty` | Wurzel der gemounteten Crafty-Ordner |
| `DATA_DIR` | `/data` | Einstellungen von Craftynos |
| `PORT` | `8080` | Port der Oberfläche |
| `ITEM_ICON_URL` / `BLOCK_ICON_URL` | PrismarineJS-Assets via jsDelivr | Icon-Quelle, Platzhalter `{name}` |
| `HEAD_URL` | `https://mc-heads.net/avatar/{uuid}/64` | Spielerköpfe, Platzhalter `{uuid}` |

## Entwicklung

```bash
npm install
CRAFTY_ROOT=/pfad/zu/crafty-ordner npm run dev
```

Das Image wird per GitHub Action (`.github/workflows/docker.yml`) nach `ghcr.io/tammo2701/craftynos` gebaut (amd64 + arm64).

## Hinweise

- Backup-Zugangsdaten (WebDAV/SFTP) und ein in der Oberfläche eingegebener API-Token liegen im Klartext in `/data/settings.json`. Das Volume entsprechend schützen.
- Ohne API kennt Craftynos den Laufstatus nicht. Backups dann am besten bei gestopptem Server erstellen, und Whitelist-Änderungen bei laufendem Server mit `/whitelist reload` übernehmen.
- Spielerdaten schreibt Minecraft nur beim Speichern bzw. Ausloggen; die Anzeige zeigt den letzten gespeicherten Stand.
- Itemnamen werden vorerst englisch (ID) angezeigt.
