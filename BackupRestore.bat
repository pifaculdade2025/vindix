@echo off

echo Indo para a pasta do gbak...
cd "C:\Program Files\Firebird\Firebird_5_0"

echo Fazendo BACKUP...
gbak -b -user SYSDBA -password masterkey "C:\VindiX\HUMANIZARE.FDB" "C:\VindiX\HUMANIZARE.FBK"

echo Fazendo RESTORE...
gbak -c -user SYSDBA -password masterkey "C:\VindiX\HUMANIZARE.FBK" "C:\VindiX\EMPRESA1.FDB"

echo Processo finalizado.
pause
