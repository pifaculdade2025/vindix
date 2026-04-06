program VindiX;

{$APPTYPE GUI}
{$R *.res}

uses
  System.SysUtils,
  System.IOUtils,
  Winapi.Windows,
  IdHTTPServer,
  IdCustomHTTPServer,
  IdContext,
  System.JSON,
  UnConexao in 'UnConexao.pas',
  UnRelatorioRegistroEvolucaoPDF in 'UnRelatorioRegistroEvolucaoPDF.pas',
  UnFuncoes in 'UnFuncoes.pas',
  UnAgenda in 'UnAgenda.pas',
  UnToken in 'UnToken.pas';

type
  TServidor = class
    Server: TIdHTTPServer;
    procedure CommandGet(AContext: TIdContext;
      ARequestInfo: TIdHTTPRequestInfo;
      AResponseInfo: TIdHTTPResponseInfo);
    procedure CommandOther(AContext: TIdContext;
      ARequestInfo: TIdHTTPRequestInfo;
      AResponseInfo: TIdHTTPResponseInfo);
    procedure Iniciar;
    procedure Parar;
  end;

procedure TServidor.CommandOther(AContext: TIdContext;
  ARequestInfo: TIdHTTPRequestInfo;
  AResponseInfo: TIdHTTPResponseInfo);
begin
  CommandGet(AContext, ARequestInfo, AResponseInfo);
end;

procedure TServidor.CommandGet(AContext: TIdContext;
  ARequestInfo: TIdHTTPRequestInfo;
  AResponseInfo: TIdHTTPResponseInfo);
begin
  AResponseInfo.CustomHeaders.Add('Access-Control-Allow-Origin: *');
  AResponseInfo.CustomHeaders.Add('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  AResponseInfo.CustomHeaders.Add('Access-Control-Allow-Headers: Xtoken, Content-Type');
  AResponseInfo.ContentType := 'application/json; charset=utf-8';

  if ARequestInfo.CommandType = hcOPTION then
  begin
    AResponseInfo.ResponseNo := 200;
    Exit;
  end;

  try
    if ARequestInfo.Document = '/login' then
      ValidarLogin(ARequestInfo.Params.Values['usuario'], ARequestInfo.Params.Values['senha'], AResponseInfo)
    else if ARequestInfo.Document = '/consultas' then
      CarregarConsultas(GetUsuarioLogado(ARequestInfo), AResponseInfo)
    else if ARequestInfo.Document = '/imprimir' then
      Imprimir(ARequestInfo, AResponseInfo)
    else if ARequestInfo.Document = '/EventoGoogle' then //Adicionar no google agenda
      ChamarEventoGoogle(ARequestInfo, AResponseInfo)
    else if ARequestInfo.Document = '/ConectarGoogle' then //Cadastrar email no google agenda
      ConectarGoogle(ARequestInfo, AResponseInfo)
    else if ARequestInfo.Document = '/oauth2callback' then //Redirecionamento do google agenda
      GravarTokenGoogle(ARequestInfo.Params.Values['code'], StrToInt(ARequestInfo.Params.Values['state']), AResponseInfo)
    else
    begin
      AResponseInfo.ResponseNo := 404;
      AResponseInfo.ContentText := '{"erro": "rota nao encontrada"}';
    end;
  except
    on E: Exception do
    begin
      var JSONErro := TJSONObject.Create;
      try
        JSONErro.AddPair('erro', E.Message);
        AResponseInfo.ResponseNo := 500;
        AResponseInfo.ContentType := 'application/json; charset=utf-8';
        AResponseInfo.ContentText := JSONErro.ToString;
      finally
        JSONErro.Free;
      end;
    end;
  end;
end;

procedure TServidor.Iniciar;
begin
  Server := TIdHTTPServer.Create(nil);
  Server.DefaultPort := 8080;
  Server.OnCommandGet := CommandGet;
  Server.OnCommandOther := CommandOther;
  Server.Active := True;
end;

procedure TServidor.Parar;
begin
  Server.Active := False;
  Server.Free;
end;

var
  Servidor: TServidor;

begin
  ConectarBancoPrincipal;
  try
    Servidor := TServidor.Create;
    Servidor.Iniciar;
    var Msg: TMsg;
    while GetMessage(Msg, 0, 0, 0) do
    begin
      TranslateMessage(Msg);
      DispatchMessage(Msg);
    end;

    Servidor.Parar;
    Servidor.Free;

    if Assigned(qUsuarios) then
      qUsuarios.Free;

//    if Assigned(qDataBDPrincipal) then
//      qDataBDPrincipal.Free;

    DesconectarBancoPrincipal;
  except
    on E: Exception do
      TFile.AppendAllText('erro.log', E.Message);
  end;
end.
