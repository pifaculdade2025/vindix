/* Tema claro/escuro (arquivo separado para a CSP não precisar liberar scripts inline).
   Sem escolha salva, segue o tema do sistema operacional. */
(function(){
  var salvo=null;
  try{salvo=localStorage.getItem('vindix:theme');}catch(e){}
  var sistemaEscuro=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme',salvo||(sistemaEscuro?'dark':'light'));
  // Menu retraído: aplicado antes de desenhar a página, para ele não abrir e fechar ao carregar
  try{if(localStorage.getItem('vindix:menu')==='retraido')document.documentElement.setAttribute('data-menu','retraido');}catch(e){}

  function aplicar(tema){
    document.documentElement.setAttribute('data-theme',tema);
    try{localStorage.setItem('vindix:theme',tema);}catch(e){}
  }
  function alternar(){aplicar(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');}

  document.addEventListener('DOMContentLoaded',function(){
    ['btn-theme','btn-theme-top'].forEach(function(id){var b=document.getElementById(id);if(b)b.addEventListener('click',alternar);});
    ['input-user','input-pass'].forEach(function(id){
      var el=document.getElementById(id);
      if(el)el.addEventListener('input',function(){var e=document.getElementById('login-error');if(e)e.hidden=true;});
    });
  });
})();
