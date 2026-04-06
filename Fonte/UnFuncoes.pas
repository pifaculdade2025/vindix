unit UnFuncoes;

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
  System.DateUtils;

  procedure ValidarLogin(Usuario, Senha: string; AResponseInfo: TIdHTTPResponseInfo);
  procedure CarregarConsultas(CodigoUsuario: Integer; AResponseInfo: TIdHTTPResponseInfo);
  procedure GerarRelatorio(Codigo: Integer; Stream: TMemoryStream; CodigoUsuario: Integer);
  procedure Imprimir(ARequestInfo: TIdHTTPRequestInfo; AResponseInfo: TIdHTTPResponseInfo);

implementation

uses
  UnConexao,
  UnRelatorioRegistroEvolucaoPDF,
  UnToken;

procedure ValidarLogin(Usuario, Senha: string; AResponseInfo: TIdHTTPResponseInfo);
var
  JSON: TJSONObject;
  qDataBDPrincipal: TFDQuery;
begin
  JSON := TJSONObject.Create;
  qDataBDPrincipal := TFDQuery.Create(nil);
  qDataBDPrincipal.Connection := ConexaoPrincipal;
  try
    qDataBDPrincipal.Close;
    qDataBDPrincipal.SQL.Text := 'SELECT ID, NOME FROM USUARIOS WHERE LOGIN = :psLogin AND SENHA = :piSenha';
    qDataBDPrincipal.ParamByName('psLogin').AsString := Usuario;
    qDataBDPrincipal.ParamByName('piSenha').AsString := Senha;
    qDataBDPrincipal.Open;

    if not qDataBDPrincipal.IsEmpty then
    begin
      JSON.AddPair('sucesso', TJSONBool.Create(True));
      JSON.AddPair('mensagem', 'Login realizado com sucesso!');
      JSON.AddPair('nome', qDataBDPrincipal.FieldByName('NOME').AsString);
      JSON.AddPair('token', GerarToken(qDataBDPrincipal.FieldByName('ID').AsInteger));
    end
    else
    begin
      JSON.AddPair('sucesso', TJSONBool.Create(False));
      JSON.AddPair('mensagem', 'Usuário ou senha incorretos.');
    end;

    AResponseInfo.ResponseNo := 200;
    AResponseInfo.ContentText := JSON.ToString;
  finally
    qDataBDPrincipal.Free;
    JSON.Free;
  end;
end;

procedure CarregarConsultas(CodigoUsuario: Integer; AResponseInfo: TIdHTTPResponseInfo);
begin
  if GetConexaoUsuario(CodigoUsuario) = nil then
  begin
    AResponseInfo.ResponseNo := 200;
    AResponseInfo.ContentType := 'application/json; charset=utf-8';
    AResponseInfo.ContentText := '{"erro": "Usuario nao encontrado"}';
    Exit;
  end;

  var qConsultas := TFDQuery.Create(nil);
  var JSON := TJSONArray.Create;
  try
    qConsultas.Connection := GetConexaoUsuario(CodigoUsuario);
    qConsultas.SQL.Text :=
      ' SELECT '+
      '    CONSULTAS.ID, '+
      '    PACIENTES.NOME AS PACIENTE, '+
      '    TERAPEUTAS.NOME AS TERAPEUTA, '+
      '    CONSULTAS.DT_HR_SESSAO DATA_HORA, '+
      '    ESPECIALIDADES.DESCRICAO AS ESPECIALIDADE ' +
      ' FROM CONSULTAS  ' +
      '    JOIN CADASTROS PACIENTES ON PACIENTES.ID = CONSULTAS.ID_PACIENTE ' +
      '    JOIN CADASTROS TERAPEUTAS ON TERAPEUTAS.ID = CONSULTAS.ID_TERAPEUTA ' +
      '    JOIN ESPECIALIDADES ON ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE ' +
      'ORDER BY CONSULTAS.DT_HR_SESSAO DESC';
    qConsultas.Open;

    while not qConsultas.Eof do
    begin
      var Row := TJSONObject.Create;
      Row.AddPair('id', TJSONNumber.Create(qConsultas.FieldByName('ID').AsInteger));
      Row.AddPair('paciente', qConsultas.FieldByName('PACIENTE').AsString);
      Row.AddPair('terapeuta', qConsultas.FieldByName('TERAPEUTA').AsString);
      Row.AddPair('dataHora', qConsultas.FieldByName('DATA_HORA').AsString);
      Row.AddPair('especialidade', qConsultas.FieldByName('ESPECIALIDADE').AsString);
      JSON.Add(Row);
      qConsultas.Next;
    end;

    AResponseInfo.ResponseNo := 200;
    AResponseInfo.ContentType := 'application/json; charset=utf-8';
    AResponseInfo.ContentText := JSON.ToString;
  finally
    qConsultas.Free;
    JSON.Free;
  end;
end;

procedure GerarRelatorio(Codigo: Integer; Stream: TMemoryStream; CodigoUsuario: Integer);
var
  qConsultas: TFDQuery;
  qDataBDPrincipal: TFDQuery;
begin                                  
  qConsultas := TFDQuery.Create(nil);
  qDataBDPrincipal := TFDQuery.Create(nil);
  try
    qDataBDPrincipal.Connection := ConexaoPrincipal;
    qDataBDPrincipal.Close;
    qDataBDPrincipal.SQL.Text := ' SELECT '+
                                 '   EMPRESAS.CAMINHO_LOGOS '+
                                 ' FROM EMPRESAS '+
                                 '   JOIN USUARIOS ON '+
                                 '        (USUARIOS.EMPRESA = EMPRESAS.ID) '+
                                 ' WHERE USUARIOS.ID = :piCodUser';
    qDataBDPrincipal.ParamByName('piCodUser').AsInteger := CodigoUsuario;
    qDataBDPrincipal.Open;
  
    qConsultas.Connection := GetConexaoUsuario(CodigoUsuario);
    qConsultas.SQL.Text :=
      ' SELECT '+
      '    CONSULTAS.ID, '+
      '    PACIENTE.NOME NOME_PACIENTE, ' +
      '    DATEDIFF(YEAR FROM PACIENTE.DT_NASC TO CONSULTAS.DT_HR_SESSAO) - '+
      '    CASE'+
      '       WHEN EXTRACT(MONTH FROM CONSULTAS.DT_HR_SESSAO) < EXTRACT(MONTH FROM PACIENTE.DT_NASC)'+
      '         OR ('+
      '              EXTRACT(MONTH FROM CONSULTAS.DT_HR_SESSAO) = EXTRACT(MONTH FROM PACIENTE.DT_NASC)'+
      '              AND EXTRACT(DAY FROM CONSULTAS.DT_HR_SESSAO) < EXTRACT(DAY FROM PACIENTE.DT_NASC)'+
      '            )'+
      '       THEN 1'+
      '       ELSE 0'+
      '    END as IDADE,'+
      '    TERAPEUTA.NOME AS NOME_PROF, '+
      '    ESPECIALIDADES.DESCRICAO ESPECIALIDADE, ' +
      '    PACIENTE.DIAGNOSTICO, ' +
      '    EXTRACT(YEAR FROM CONSULTAS.DT_HR_SESSAO) ANO, ' +
      '    CONSULTAS.RESUMO_SESSAO ' +
      ' FROM CONSULTAS ' +
      '    JOIN CADASTROS PACIENTE ON PACIENTE.ID = CONSULTAS.ID_PACIENTE ' +
      '    JOIN CADASTROS TERAPEUTA  ON TERAPEUTA.ID  = CONSULTAS.ID_TERAPEUTA ' +
      '    JOIN ESPECIALIDADES ON ESPECIALIDADES.ID = CONSULTAS.ID_ESPECIALIDADE ' +
      'WHERE CONSULTAS.ID = :pCod';
    qConsultas.ParamByName('pCod').AsInteger := Codigo;
    qConsultas.Open;

    if qConsultas.IsEmpty then
      raise Exception.Create('Registro nao encontrado');

    GerarRelatorioEvolucaoPDF(qConsultas, Stream, qDataBDPrincipal.FieldByName('CAMINHO_LOGOS').AsString);
  finally
    qDataBDPrincipal.Free;
    qConsultas.Free;
  end;
end;

procedure Imprimir(ARequestInfo: TIdHTTPRequestInfo; AResponseInfo: TIdHTTPResponseInfo);
var
  Body: TJSONObject;
  Stream: TMemoryStream;
begin
  ARequestInfo.PostStream.Position := 0;
  Body := TJSONObject.ParseJSONValue(ReadStringFromStream(ARequestInfo.PostStream, -1, IndyTextEncoding_UTF8)) as TJSONObject;
  Stream := TMemoryStream.Create;

  try
    try
      GerarRelatorio(Body.GetValue<Integer>('codigo'), Stream, GetUsuarioLogado(ARequestInfo));
      Stream.Position := 0;

      AResponseInfo.ResponseNo  := 200;
      AResponseInfo.ContentType := 'application/pdf';
      AResponseInfo.CustomHeaders.Add('Content-Disposition: inline; filename="relatorio.pdf"');
      AResponseInfo.ContentStream := Stream;
      AResponseInfo.FreeContentStream := True;
    except
      Stream.Free;
      raise;
    end;
  finally
    Body.Free;
  end;
end;

end.
