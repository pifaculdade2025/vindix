# =============================================================================
# BACKUP FIREBIRD - VINDIX (WINDOWS)
# =============================================================================
#
# PRÉ-REQUISITOS:
#   1. Python instalado: https://www.python.org/downloads/
#   2. Firebird 5.0 instalado em: C:\Program Files\Firebird\Firebird_5_0\
#   3. rclone instalado e configurado com Google Drive:
#        - Baixar em: https://rclone.org/downloads/
#        - Extrair o rclone.exe em C:\rclone\
#        - Rodar no terminal: rclone config
#        - Criar um remote chamado "gdrive" apontando pro Google Drive
#
# COMO RODAR:
#   python backup_firebird.py
#
# COMO AGENDAR (Agendador de Tarefas do Windows):
#   - Abrir "Agendador de Tarefas"
#   - Criar Tarefa Básica
#   - Ação: Iniciar um programa
#   - Programa: python
#   - Argumentos: C:\VindiX\backup_firebird.py
#   - Definir horário desejado (ex: todo dia às 02:00)
# =============================================================================

import subprocess
import os
from datetime import datetime

# =============================================================================
# CONFIGURAÇÕES — AJUSTE SE NECESSÁRIO
# =============================================================================

FIREBIRD_DIR      = r"C:\Program Files\Firebird\Firebird_5_0"
GBAK_PATH         = os.path.join(FIREBIRD_DIR, "gbak.exe")

FIREBIRD_USER     = "SYSDBA"
FIREBIRD_PASSWORD = "masterkey"

DB_PATH           = r"C:\VindiX\HUMANIZARE.FDB"
BACKUP_DIR        = r"C:\VindiX\Backups"
LOG_FILE          = r"C:\VindiX\Backups\backup.log"

RCLONE_PATH       = r"C:\rclone\rclone.exe"        # Caminho do executável do rclone
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
    backup_file = os.path.join(BACKUP_DIR, f"HUMANIZARE_{timestamp}.FBK")

    log(f"Gerando backup: {backup_file}")

    cmd = [
        GBAK_PATH, "-b",
        "-user",     FIREBIRD_USER,
        "-password", FIREBIRD_PASSWORD,
        DB_PATH,     backup_file
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=FIREBIRD_DIR)

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
    import time
    agora     = time.time()
    removidos = 0

    for f in os.listdir(BACKUP_DIR):
        if not f.upper().endswith(".FBK"):
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
    log("INICIO DO BACKUP - VINDIX")
    log("=" * 60)

    backup_file = gerar_backup()

    if backup_file:
        if USAR_DRIVE:
            enviar_google_drive()

    limpar_antigos()

    log("=" * 60)
    log("FIM DO BACKUP")
    log("=" * 60)