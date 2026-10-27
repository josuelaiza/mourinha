// ================================================================== //
// == SENHA DO PAINEL E DAS FERRAMENTAS                            == //
// ================================================================== //
// Uma barreira simples, não é segurança de verdade: o repositório é
// público, então quem souber ler o código consegue contornar.
// Guardamos só o SHA-256 da senha, para ela não aparecer no código.
// Para trocar a senha, gere o novo hash com:
//   printf '%s' 'NOVA_SENHA' | sha256sum
//
// Cada página inclui este arquivo no <head>:
//   painel:       <script src="senha.js"></script>
//   ferramentas:  <script src="../senha.js"></script>
// Uma ferramenta baixada e aberta fora do site não acha este arquivo
// e abre sem pedir senha.

(function () {
    const HASH_SENHA = '595a8d552d9f40ba6a945309f64ed6c51ad833c5f68d8ae17678f71497a47e4e';
    const CHAVE_LIBERADO = 'painelLiberado';

    // Lembra a senha neste aparelho; se a senha mudar, pede de novo
    let liberado = false;
    try { liberado = localStorage.getItem(CHAVE_LIBERADO) === HASH_SENHA; } catch (e) { /* sem storage: pede sempre */ }
    if (liberado) return;

    // Esconde a página até a senha certa. visibility (e não display) para as
    // ferramentas continuarem medindo e montando a tela normalmente por baixo.
    const estilo = document.createElement('style');
    estilo.textContent = `
        body { visibility: hidden !important; overflow: hidden !important; }
        #portaoSenha {
            visibility: visible !important;
            position: fixed; inset: 0; z-index: 2147483647;
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            padding: 20px; text-align: center;
            background: linear-gradient(135deg, #1e1e1e, #121212);
            color: #e0e0e0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        #portaoSenha * { box-sizing: border-box; margin: 0; }
        #portaoSenha h1 { font-size: 2.5rem; font-weight: 600; letter-spacing: -1px; margin-bottom: 10px; color: #e0e0e0; }
        #portaoSenha p { font-size: 1.1rem; color: #b3b3b3; margin-bottom: 30px; }
        #portaoSenha form { width: 100%; max-width: 400px; display: flex; gap: 10px; }
        #portaoSenha input {
            flex: 1; min-width: 0; padding: 15px 20px; font-size: 1rem; font-family: inherit;
            color: #e0e0e0; background-color: #2c2c2c; border: 1px solid #444; border-radius: 8px;
        }
        #portaoSenha input:focus { outline: none; border-color: #007BFF; box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25); }
        #portaoSenha button {
            padding: 15px 20px; font-size: 1rem; font-family: inherit;
            color: #fff; background-color: #007BFF; border: none; border-radius: 8px; cursor: pointer;
        }
        #portaoSenha .senha-erro { min-height: 1.5em; margin-top: 12px; color: #ff6b6b; font-size: 0.95rem; }
        @media (max-width: 600px) {
            #portaoSenha h1 { font-size: 2rem; }
            #portaoSenha p { font-size: 1rem; }
        }
    `;
    document.head.appendChild(estilo);

    async function sha256(texto) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
        return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function montarPortao() {
        const portao = document.createElement('div');
        portao.id = 'portaoSenha';
        portao.innerHTML = `
            <h1>Painel de Ferramentas</h1>
            <p>Digite a senha para acessar.</p>
            <form>
                <input type="password" inputmode="numeric" autocomplete="current-password" placeholder="Senha" aria-label="Senha">
                <button type="submit">Entrar</button>
            </form>
            <div class="senha-erro" role="alert"></div>
        `;
        document.body.appendChild(portao);

        const campo = portao.querySelector('input');
        const erro = portao.querySelector('.senha-erro');
        campo.focus();

        portao.querySelector('form').addEventListener('submit', async function (evento) {
            evento.preventDefault();
            if (await sha256(campo.value.trim()) === HASH_SENHA) {
                try { localStorage.setItem(CHAVE_LIBERADO, HASH_SENHA); } catch (e) { /* sem storage: só nesta visita */ }
                portao.remove();
                estilo.remove();
            } else {
                erro.textContent = 'Senha incorreta.';
                campo.select();
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarPortao);
    else montarPortao();
})();
