@echo off

echo Indo para a pasta do gbak...
cd "C:\Program Files\Firebird\Firebird_5_0"

echo Fazendo BACKUP...
gbak -b -user SYSDBA -password masterkey "C:\VindiX\VINDIX.FDB" "C:\VindiX\VINDIX.FBK"

echo Fazendo RESTORE...
gbak -c -user SYSDBA -password masterkey "C:\VindiX\VINDIX.FBK" "C:\VindiX\DB\VINDIX.FDB"

echo Processo finalizado.
pause
