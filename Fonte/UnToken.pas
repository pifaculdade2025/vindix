unit UnToken;

interface

uses
  JOSE.Core.JWT,
  JOSE.Core.JWS,
  JOSE.Core.Builder,
  JOSE.Types.Bytes,
  IdCustomHTTPServer;

  function GerarToken(CodUsuario: Integer): string;
  function GetSecret: string;
  function GetUsuarioLogado(ARequestInfo: TIdHTTPRequestInfo): Integer;
  function ExtrairUsuarioDoToken(Token: string): Integer;

implementation

uses
  System.SysUtils;

function GerarToken(CodUsuario: Integer): string;
var
  LToken: TJWT;
begin
  LToken := TJWT.Create;
  try
    LToken.Claims.Subject := CodUsuario.ToString;
    LToken.Claims.IssuedAt := Now;
    LToken.Claims.Expiration := Now + 1;

    Result := TJOSE.SHA256CompactToken(
      GetSecret,
      LToken
    );
  finally
    LToken.Free;
  end;
end;

function GetSecret: string;
begin
  Result := GetEnvironmentVariable('JWT_SECRET');
end;

function GetUsuarioLogado(ARequestInfo: TIdHTTPRequestInfo): Integer;
var
  Token: string;
begin
  Token := ARequestInfo.RawHeaders.Values['Xtoken'];

  if Token = '' then
    raise Exception.Create('Não autorizado');

  Token := StringReplace(Token, 'Bearer ', '', []);

  Result := ExtrairUsuarioDoToken(Token);
end;

function ExtrairUsuarioDoToken(Token: string): Integer;
var
  LJWT: TJWT;
  LJWS: TJWS;
  Secret: string;
begin
  Secret := GetSecret;

  if Secret = '' then
    raise Exception.Create('Chave JWT não configurada');

  LJWT := TJWT.Create;
  try
    LJWS := TJWS.Create(LJWT);
    try
      LJWS.SetKey(TEncoding.UTF8.GetBytes(Secret));

      LJWS.CompactToken := Token;

      if not LJWS.VerifySignature then
        raise Exception.Create('Token inválido');

    finally
      LJWS.Free;
    end;

    if LJWT.Claims.Expiration < Now then
      raise Exception.Create('Token expirado');

    Result := StrToInt(LJWT.Claims.Subject);

  finally
    LJWT.Free;
  end;
end;

end.
