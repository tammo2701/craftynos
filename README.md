# Craftynos

Aternos-artige Weboberfläche **neben** [Crafty Controller](https://craftycontrol.com). Craftynos ist kein eigener Server-Manager: Start/Stop/Konsole laufen über die Crafty-API, Dateien (Inventar, Whitelist, Properties, Backups, Dateimanager) werden direkt über gemeinsame Docker-Volumes gelesen und bearbeitet.

## Funktionen (Stand: Frontend + Backend-Grundgerüst, noch nicht gegen eine echte Crafty-Instanz getestet)

- Serverliste mit Status, Spielerzahl, CPU/RAM, Start / Stop / Neustart
- Serverseite mit Live-Konsole und Befehlseingabe
- **Spieler & Inventar:** Spielerliste (online, OP, gebannt), Inventar inkl. Rüstung und Endertruhe, Leben/Hunger/Level, Position, Respawn, letzter Tod, Statistiken (Spielzeit, Tode, Strecken, abgebaute Blöcke …) – gelesen aus `playerdata/*.dat` und `stats/*.json`
- **Whitelist:** hinzufügen/entfernen (live per Konsole, wenn der Server läuft, sonst direkt in `whitelist.json`)
- **server.properties:** Aternos-/Crafty-ähnliche Karten für die wichtigsten Optionen, dazu alle weiteren unter „Erweitert“
- **Dateimanager:** durchsuchen, bearbeiten, hoch-/herunterladen, löschen
- **Backups:** Crafty-Backup auslösen, Liste, Download, Löschen, Kopieren auf Ziele
- **Backup-Ziele (in der Oberfläche einstellbar):** lokaler Ordner / NAS-Mount, Nextcloud (WebDAV), SFTP – optional mit automatischem Sync neuer Backups

**Noch nicht gebaut (kommt zum Schluss):** Webhooks und Discord-Bot-Integration, Login.

> ⚠️ Es gibt noch **keinen Login**. Craftynos nicht ungeschützt ins Internet stellen (nur im LAN / hinter Reverse-Proxy mit Auth).

## Installation (Docker)

1. In Crafty einen **API-Token** erzeugen (Crafty → dein Benutzer → *API-Schlüssel*).
2. In deine bestehende Crafty-`docker-compose.yml` den Service `craftynos` einfügen (komplettes Beispiel siehe unten bzw. [`docker-compose.example.yml`](docker-compose.example.yml)). Wichtig: Die Volumes `/crafty/servers`, `/crafty/backups` und `/crafty/logs` müssen auf dieselben Host-Ordner zeigen und **mit denselben Containerpfaden** wie bei Crafty gemountet sein, damit die von Crafty gemeldeten Pfade direkt passen.
3. `docker compose up -d` und `http://<host>:8080` öffnen.

### Beispiel: Crafty + Craftynos in einer Compose

Ausgangspunkt ist eine normale Crafty-Compose; neu ist nur der Block `craftynos`:

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
            CRAFTY_URL: https://crafty:8443
            CRAFTY_API_TOKEN: HIER_DEN_API_TOKEN_AUS_CRAFTY   # alternativ in der Oberfläche eintragen

        ports:
            - "8080:8080"                    # Craftynos Weboberfläche

        volumes:
            # Dieselben Host-Ordner und Containerpfade wie bei Crafty
            - /srv/docker/crafty-4/backups:/crafty/backups
            - /srv/docker/crafty-4/logs:/crafty/logs
            - /srv/docker/crafty-4/servers:/crafty/servers
            # Eigene Einstellungen (Backup-Ziele, Sync-Status)
            - /srv/docker/craftynos:/data
            # Optional: auf dem Host gemountetes NAS als lokales Backup-Ziel
            # - /mnt/nas/minecraft:/mnt/nas
```

Der Hostname `crafty` in `CRAFTY_URL` ist der Service-Name aus derselben Compose. Läuft Craftynos in einer separaten Compose, muss stattdessen die Adresse des Hosts bzw. ein gemeinsames Docker-Netzwerk verwendet werden.

Der Token kann statt per `CRAFTY_API_TOKEN` auch in der Oberfläche unter *Einstellungen* eingetragen werden (wird in `/data/settings.json` gespeichert).

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `CRAFTY_URL` | `https://crafty:8443` | Adresse von Crafty |
| `CRAFTY_API_TOKEN` | – | API-Token (hat Vorrang vor der Oberfläche) |
| `CRAFTY_INSECURE_TLS` | `true` | Selbstsigniertes Crafty-Zertifikat akzeptieren |
| `CRAFTY_ROOT` | `/crafty` | Fallback-Wurzel für Pfad-Remapping, falls Mounts anders heißen |
| `DATA_DIR` | `/data` | Einstellungen (Backup-Ziele, Sync-Status) |
| `PORT` | `8080` | Port der Oberfläche |
| `ITEM_ICON_URL` / `BLOCK_ICON_URL` | PrismarineJS-Assets via jsDelivr | Icon-Quelle mit Platzhalter `{name}` |
| `HEAD_URL` | `https://mc-heads.net/avatar/{uuid}/64` | Spielerköpfe, Platzhalter `{uuid}` |

## Entwicklung

```bash
npm install
CRAFTY_URL=https://localhost:8443 CRAFTY_API_TOKEN=... CRAFTY_ROOT=/pfad/zu/crafty npm run dev
```

Das Image wird per GitHub Action (`.github/workflows/docker.yml`) nach `ghcr.io/tammo2701/craftynos` gebaut (amd64 + arm64).

## Hinweise

- Backup-Zugangsdaten (WebDAV/SFTP) liegen im Klartext in `/data/settings.json`. Das Volume entsprechend schützen.
- Spielerdaten (Inventar, Position …) schreibt Minecraft nur beim Speichern bzw. Ausloggen – die Anzeige zeigt den letzten gespeicherten Stand.
- Itemnamen werden vorerst englisch (ID) angezeigt.
