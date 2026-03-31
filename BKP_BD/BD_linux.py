# =============================================================================
# BACKUP FIREBIRD - VINDIX (LINUX - VPS HOSTINGER)
# =============================================================================
#
# PRÉ-REQUISITOS:
#   1. Instalar Python e Firebird:
#        sudo apt update && sudo apt upgrade -y
#        sudo apt install python3 firebird3.0-server firebird3.0-utils -y
#        sudo systemctl enable firebird3.0
#        sudo systemctl start firebird3.0
#
#   2. Criar pastas necessárias:
#        sudo mkdir -p /opt/backups/vindix
#        sudo mkdir -p /var/log/vindix
#        sudo chmod 755 /opt/backups/vindix
#        sudo chmod 755 /var/log/vindix
#
#   3. Instalar e configurar o rclone:
#        curl https://rclone.org/install.sh | sudo bash
#        rclone config
#        > Criar um remote chamado "gdrive" apontando pro Google Drive
#        > Em VPS (sem navegador), usar: rclone authorize "drive" no seu PC
#          e colar o token na VPS
#
#   4. Copiar este script pra VPS:
#        scp backup_firebird_linux.py root@SEU_IP:/opt/scripts/
#
# COMO RODAR MANUALMENTE:
#   python3 /opt/scripts/backup_firebird_linux.py
#
# COMO AGENDAR COM CRON (todo dia às 02:00):
#   crontab -e
#   Adicionar a linha:
#   0 2 * * * /usr/bin/python3 /opt/scripts/backup_firebird_linux.py
#
# VERIFICAR LOGS:
#   tail -f /var/log/vindix/backup.log
# =============================================================================

import subprocess
import os
import time
from datetime import datetime

# =============================================================================
# CONFIGURAÇÕES — AJUSTE SE NECESSÁRIO
# =============================================================================

GBAK_PATH         = "/usr/bin/gbak"

FIREBIRD_USER     = "SYSDBA"
FIREBIRD_PASSWORD = "masterkey"

DB_PATH           = "/var/lib/firebird/3.0/data/HUMANIZARE.FDB"
BACKUP_DIR        = "/opt/backups/vindix"
LOG_FILE          = "/var/log/vindix/backup.log"

RCLONE_PATH       = "/usr/bin/rclone"              # Caminho do rclone (verificar com: which rclone)
RCLONE_REMOTE     = "gdrive:backups/vindix"         # Remote configurado no rclone config
USAR_DRIVE        = True                            # False pra desativar o envio ao Drive

DIAS_RETENCAO     = 7                               # Remove backups mais antigos que X dias


# =============================================================================
# FUNÇÕES
# =============================================================================

def log(msg):
    """Registra mensagem no terminal e no arquivo de log."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    linha = f"[{timestamp}] {msg}"
    print(linha)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(linha + "\n")


def gerar_backup():
    """Roda o gbak e gera o arquivo .fbk."""
    os.makedirs(BACKUP_DIR, exist_ok=True)

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"HUMANIZARE_{timestamp}.fbk")

    log(f"Gerando backup: {backup_file}")

    cmd = [
        GBAK_PATH, "-b",
        "-user",     FIREBIRD_USER,
        "-password", FIREBIRD_PASSWORD,
        DB_PATH,     backup_file
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        log(f"ERRO no gbak: {result.stderr.strip()}")
        return None

    tamanho = os.path.getsize(backup_file) / (1024 * 1024)
    log(f"Backup gerado com sucesso! ({tamanho:.1f} MB)")
    return backup_file


def enviar_google_drive():
    """Envia a pasta de backups pro Google Drive via rclone."""
    log(f"Enviando backups pro Google Drive ({RCLONE_REMOTE})...")

    result = subprocess.run(
        [RCLONE_PATH, "copy", BACKUP_DIR, RCLONE_REMOTE, "--progress"],
        capture_output=True, text=True
    )

    if result.returncode == 0:
        log("Upload concluido com sucesso.")
    else:
        log(f"ERRO no rclone: {result.stderr.strip()}")


def limpar_antigos():
    """Remove backups locais mais antigos que DIAS_RETENCAO dias."""
    agora     = time.time()
    removidos = 0

    for f in os.listdir(BACKUP_DIR):
        if not f.lower().endswith(".fbk"):
            continue
        caminho    = os.path.join(BACKUP_DIR, f)
        idade_dias = (agora - os.stat(caminho).st_mtime) / 86400
        if idade_dias > DIAS_RETENCAO:
            os.remove(caminho)
            log(f"Removido (>{DIAS_RETENCAO} dias): {f}")
            removidos += 1

    if removidos == 0:
        log("Nenhum backup antigo para remover.")


# =============================================================================
# EXECUÇÃO PRINCIPAL
# =============================================================================

if __name__ == "__main__":
    log("=" * 60)
    log("INICIO DO BACKUP - VINDIX (LINUX)")
    log("=" * 60)

    backup_file = gerar_backup()

    if backup_file:
        if USAR_DRIVE:
            enviar_google_drive()

    limpar_antigos()

    log("=" * 60)
    log("FIM DO BACKUP")
    log("=" * 60)