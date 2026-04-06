unit UnAgenda;

interface

uses
  IdCustomHTTPServer,
  System.Classes,
  FireDAC.Comp.Client,
  FireDAC.DApt,
  System.JSON,
  FireDAC.Stan.Param,
  IdGlobal,
  System.SysUtils,
  System.IOUtils,
  IdSSLOpenSSL,
  System.NetEncoding,
  System.Net.HttpClient,
  System.Net.URLClient,
  System.DateUtils,
  System.IniFiles,
  JOSE.Core.JWT;

  function GetToken(piCodUser: integer): String;
  procedure CriarEventoGoogle(piCodConsulta, piCodUsuario: Integer);
  procedure ConectarGoogle(ARequestInfo: TIdHTTPRequestInfo; AResponseInfo: TIdHTTPResponseInfo);
  procedure GravarTokenGoogle(psCODE: String; piCodUsuario: Integer; AResponseInfo: TIdHTTPResponseInfo);
  procedure ChamarEventoGoogle(ARequestInfo: TIdHTTPRequestInfo; AResponseInfo: TIdHTTPResponseInfo);

implementation

uses
  UnConexao, UnToken;

var
  iniConfig: TIniFile;
  CLIENT_ID, CLIENT_SECRET, REDIRECT_URI: String;

function GetToken(piCodUser: integer): String;
var
  HTTP: THTTPClient;
  Params: TStringList;
  Resp: string;
  JSON: TJSONObject;
  idTableGoogle: Integer;
  qDataBDPrincipal: TFDQuery;
  RespHTTP: IHTTPResponse;
begin
  JSON := nil;
  qDataBDPrincipal := TFDQuery.Create(nil);
  try
    qDataBDPrincipal.Connection := ConexaoPrincipal;
    qDataBDPrincipal.Close;
    qDataBDPrincipal.SQL.Text := ' SELECT '+
                                 '   GOOGLE_TOKEN.ID, GOOGLE_TOKEN.REFRESH_TOKEN, GOOGLE_TOKEN.ACCESS_TOKEN, GOOGLE_TOKEN.EXPIRA_EM '+
                                 ' FROM GOOGLE_TOKEN '+
                                 '   JOIN USUARIOS ON '+
                                 '        (USUARIOS.EMPRESA = GOOGLE_TOKEN.ID_EMPRESA) '+
                                 ' WHERE USUARIOS.ID = :piCodUser';
    qDataBDPrincipal.ParamByName('piCodUser').AsInteger := piCodUser;
    qDataBDPrincipal.Open;

    if qDataBDPrincipal.IsEmpty then
    begin
      Result := '';
      Exit;
    end;

    if not (Now > qDataBDPrincipal.FieldByName('EXPIRA_EM').AsDateTime) then
    begin
      Result := qDataBDPrincipal.FieldByName('ACCESS_TOKEN').AsString;
      Exit;
    end;

    idTableGoogle := qDataBDPrincipal.FieldByName('ID').AsInteger;

    HTTP := THTTPClient.Create;
    HTTP.ConnectionTimeout := 10000;
    HTTP.ResponseTimeout := 10000;
    Params := TStringList.Create;

    try
      Params.Add('client_id='+CLIENT_ID);
      Params.Add('client_secret='+CLIENT_SECRET);
      Params.Add('refresh_token=' + qDataBDPrincipal.FieldByName('REFRESH_TOKEN').AsString);
      Params.Add('grant_type=refresh_token');

      RespHTTP := HTTP.Post('https://oauth2.googleapis.com/token', Params);

      if (RespHTTP.StatusCode < 200) or (RespHTTP.StatusCode >= 300) then
        raise Exception.Create('Erro HTTP: ' + RespHTTP.StatusText);

      Resp := RespHTTP.ContentAsString;

      JSON := TJSONObject.ParseJSONValue(Resp) as TJSONObject;

      if not Assigned(JSON) then
        raise Exception.Create('Erro ao obter token: ' + Resp);

      if JSON.GetValue('error') <> nil then
        raise Exception.Create('Erro Google: ' + JSON.ToString);

      qDataBDPrincipal.Close;
      qDataBDPrincipal.SQL.Text :=
        'UPDATE GOOGLE_TOKEN SET ACCESS_TOKEN = :AcessToken, EXPIRA_EM = :Expira WHERE ID = :piID';

      qDataBDPrincipal.ParamByName('piID').AsInteger := idTableGoogle;
      qDataBDPrincipal.ParamByName('AcessToken').AsString := JSON.GetValue<string>('access_token');
      qDataBDPrincipal.ParamByName('Expira').AsDateTime := Now + ((JSON.GetValue<Integer>('expires_in') - 300) / 86400);
      qDataBDPrincipal.ExecSQL;

      Result := JSON.GetValue<string>('access_token');

    finally
      JSON.Free;
      HTTP.Free;
      Params.Free;
    end;
  finally
    qDataBDPrincipal.Free;
  end;
end;

procedure CriarEventoGoogle(piCodConsulta, piCodUsuario: Integer);
var
  HTTP: THTTPClient;
  JSON: TStringStream;
  Resp, Token: string;
  qConsultas: TFDQuery;
  Obj, JSONResp: TJSONObject;
  RespHTTP: IHTTPResponse;
begin
  Token := GetToken(piCodUsuario);
  if Trim(Token) = '' then
    raise Exception.Create('Não configurado Token do Google Agenda');

  qConsultas := TFDQuery.Create(nil);
  try
    qConsultas.Connection := GetConexaoUsuario(piCodUsuario);
    qConsultas.SQL.Text := ' SELECT '+
                           '   CONSULTAS.DT_HR_SESSAO, '+
                           '   CONSULTAS.TEMPO_SESSAO, '+
                           '   CONSULTAS.ENVIADO_GOOGLE, '+
                           '   ESPECIALIDADES.ID_COR, '+
                           '   TERAPEUTA.NOME || '' - '' || ESPECIALIDADES.DESCRICAO TITULO '+
                           ' FROM CONSULTAS '+
                           '   JOIN CADASTROS TERAPEUTA ON (TERAPEUTA.ID = CONSULTAS.ID_TERAPEUTA) '+
                           '   JOIN ESPECIALIDADES ON (ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE) '+
                           ' WHERE CONSULTAS.ID = :piCodConsulta ';
    qConsultas.ParamByName('piCodConsulta').AsInteger := piCodConsulta;
    qConsultas.Open;

    if qConsultas.IsEmpty then
      raise Exception.Create('Consulta não encontrada');

    if qConsultas.FieldByName('ENVIADO_GOOGLE').AsString = 'S' then
      raise Exception.Create('Consulta já enviada ao Google Agenda');

    HTTP := THTTPClient.Create;
    HTTP.ConnectionTimeout := 10000;
    HTTP.ResponseTimeout := 10000;

    Obj := TJSONObject.Create;
    try
      Obj.AddPair(
        'summary',
        qConsultas.FieldByName('TITULO').AsString
      );

      Obj.AddPair(
        'start',
        TJSONObject.Create.AddPair(
          'dateTime',
          DateToISO8601(qConsultas.FieldByName('DT_HR_SESSAO').AsDateTime, True)
        )
      );

      Obj.AddPair(
        'end',
        TJSONObject.Create.AddPair(
          'dateTime',
          DateToISO8601(
            qConsultas.FieldByName('DT_HR_SESSAO').AsDateTime +
            qConsultas.FieldByName('TEMPO_SESSAO').AsDateTime,
            True
          )
        )
      );

      if qConsultas.FieldByName('ID_COR').AsInteger > 0 then
        Obj.AddPair('colorId', qConsultas.FieldByName('ID_COR').AsString);

      JSON := TStringStream.Create(Obj.ToJSON, TEncoding.UTF8);

    finally
      Obj.Free;
    end;

    try
      HTTP.ContentType := 'application/json';
      HTTP.CustomHeaders['Authorization'] :=
        'Bearer ' + Token;
      HTTP.CustomHeaders['Accept'] := 'application/json';

      JSON.Position := 0;

      RespHTTP := HTTP.Post(
                    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                    JSON);

      if (RespHTTP.StatusCode < 200) or (RespHTTP.StatusCode >= 300) then
        raise Exception.Create('Erro HTTP: ' + RespHTTP.StatusText);

      Resp := RespHTTP.ContentAsString;

      JSONResp := nil;
      try
        JSONResp := TJSONObject.ParseJSONValue(Resp) as TJSONObject;

        if not Assigned(JSONResp) then
          raise Exception.Create('Resposta inválida do Google: ' + Resp);

        if JSONResp.GetValue('error') <> nil then
          raise Exception.Create('Erro ao criar evento: ' + JSONResp.ToString);

      finally
        JSONResp.Free;
      end;

      qConsultas.Close;
      qConsultas.SQL.Text := ' UPDATE CONSULTAS SET ENVIADO_GOOGLE = ''S'' WHERE ID = :piCodConsulta ';
      qConsultas.ParamByName('piCodConsulta').AsInteger := piCodConsulta;
      qConsultas.ExecSQL;
    finally
      HTTP.Free;
      JSON.Free;
    end;
  finally
    qConsultas.Free;
  end;
end;

procedure ConectarGoogle(ARequestInfo: TIdHTTPRequestInfo; AResponseInfo: TIdHTTPResponseInfo);
var
  qDataBDPrincipal: TFDQuery;
begin
  qDataBDPrincipal := TFDQuery.Create(nil);
  try
    qDataBDPrincipal.Connection := ConexaoPrincipal;
    qDataBDPrincipal.Close;
    qDataBDPrincipal.SQL.Text := 'SELECT ID FROM GOOGLE_TOKEN WHERE ID = :IdEmpresa';
    qDataBDPrincipal.ParamByName('IdEmpresa').AsInteger := GetEmpresa(GetUsuarioLogado(ARequestInfo));
    qDataBDPrincipal.Open;

    if not qDataBDPrincipal.IsEmpty then
      raise Exception.Create('Já configurado Google Agenda para esta empresa');

    AResponseInfo.Redirect('https://accounts.google.com/o/oauth2/v2/auth?' +
                           'client_id=' + CLIENT_ID +
                           '&redirect_uri=' + REDIRECT_URI +
                           '&response_type=code' +
                           '&scope=https://www.googleapis.com/auth/calendar' +
                           '&access_type=offline' +
                           '&include_granted_scopes=true' +
                           '&state=' + IntToStr(GetUsuarioLogado(ARequestInfo)));
  finally
    qDataBDPrincipal.Free;
  end;
end;

procedure GravarTokenGoogle(psCODE: String; piCodUsuario: Integer; AResponseInfo: TIdHTTPResponseInfo);
var
  HTTP: THTTPClient;
  Params: TStringList;
  Resp: string;
  JSON: TJSONObject;
  qDataBDPrincipal: TFDQuery;
  RespHTTP: IHTTPResponse;
begin
  JSON := nil;
  HTTP := THTTPClient.Create;
  HTTP.ConnectionTimeout := 10000;
  HTTP.ResponseTimeout := 10000;
  Params := TStringList.Create;
  qDataBDPrincipal := TFDQuery.Create(nil);
  qDataBDPrincipal.Connection := ConexaoPrincipal;
  try
    Params.Add('code=' + psCODE);
    Params.Add('client_id='+CLIENT_ID);
    Params.Add('client_secret='+CLIENT_SECRET);
    Params.Add('redirect_uri='+REDIRECT_URI);
    Params.Add('grant_type=authorization_code');

    RespHTTP := HTTP.Post('https://oauth2.googleapis.com/token', Params);

    if (RespHTTP.StatusCode < 200) or (RespHTTP.StatusCode >= 300) then
      raise Exception.Create('Erro HTTP: ' + RespHTTP.StatusText);

    Resp := RespHTTP.ContentAsString;

    JSON := TJSONObject.ParseJSONValue(Resp) as TJSONObject;

    if not Assigned(JSON) then
      raise Exception.Create('Erro ao obter token: ' + Resp);

    if JSON.GetValue('error') <> nil then
      raise Exception.Create('Erro Google: ' + JSON.ToString);

    if JSON.GetValue('refresh_token') = nil then
      raise Exception.Create('Refresh_token não retornado pelo Google');

    qDataBDPrincipal.Close;
    qDataBDPrincipal.SQL.Text :=
      ' INSERT INTO GOOGLE_TOKEN (ID, ACCESS_TOKEN, REFRESH_TOKEN, EXPIRA_EM, ID_EMPRESA) '+
      ' VALUES ((SELECT COALESCE(MAX(ID), 0) + 1 FROM GOOGLE_TOKEN), '+
      '          :access_token, '+
      '          :refresh_token, '+
      '          :expires_in, '+
      '          :id_empresa);';

    qDataBDPrincipal.ParamByName('access_token').AsString := JSON.GetValue<string>('access_token');
    qDataBDPrincipal.ParamByName('refresh_token').AsString := JSON.GetValue<string>('refresh_token');
    qDataBDPrincipal.ParamByName('expires_in').AsDateTime := Now + ((JSON.GetValue<Integer>('expires_in') - 300) / 86400);
    qDataBDPrincipal.ParamByName('id_empresa').AsInteger := GetEmpresa(piCodUsuario);
    qDataBDPrincipal.ExecSQL;

  finally
    JSON.Free;
    HTTP.Free;
    Params.Free;
    qDataBDPrincipal.Free;
  end;

  AResponseInfo.ResponseNo := 200;
  AResponseInfo.ContentType := 'text/html; charset=utf-8';
  AResponseInfo.ContentText :=
    '<html><body><script>' +
    'alert("Google Calendar conectado com sucesso!");' +
    'window.close();' +
    '</script></body></html>';
end;

procedure ChamarEventoGoogle(ARequestInfo: TIdHTTPRequestInfo; AResponseInfo: TIdHTTPResponseInfo);
var
  Body: TJSONObject;
begin
  ARequestInfo.PostStream.Position := 0;
  Body := TJSONObject.ParseJSONValue(ReadStringFromStream(ARequestInfo.PostStream, -1, IndyTextEncoding_UTF8)) as TJSONObject;

  try
    CriarEventoGoogle(Body.GetValue<Integer>('Consulta'), GetUsuarioLogado(ARequestInfo));
    AResponseInfo.ResponseNo := 200;
    AResponseInfo.ContentType := 'application/json; charset=utf-8';
    AResponseInfo.ContentText := '{"sucesso": true}';
  finally
    Body.Free;
  end;
end;

initialization
  iniConfig := TIniFile.Create(ExtractFilePath(ParamStr(0)) + 'Config.ini');
  CLIENT_ID := iniConfig.ReadString('GoogleAgenda', 'CLIENT_ID', '');
  CLIENT_SECRET := iniConfig.ReadString('GoogleAgenda', 'CLIENT_SECRET', '');
  REDIRECT_URI := iniConfig.ReadString('GoogleAgenda', 'REDIRECT_URI', '');
  iniConfig.Free;

end.
