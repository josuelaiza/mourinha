document.addEventListener('DOMContentLoaded', () => {
    // --- Seleção de Elementos do DOM ---
    const markdownInput = document.getElementById('markdown-input');
    const htmlOutput = document.getElementById('html-output');
    const saveBtn = document.getElementById('save-btn');
    const pdfBtn = document.getElementById('pdf-btn');
    const savedList = document.getElementById('saved-list');

    const PLACEHOLDER_TEXT = '<p class="placeholder">A visualização formatada aparecerá aqui.</p>';

    // --- Função Principal de Conversão ---
    const convertMarkdown = () => {
        const markdownText = markdownInput.value;
        if (markdownText.trim() === '') {
            htmlOutput.innerHTML = PLACEHOLDER_TEXT;
        } else {
            // Utiliza a biblioteca 'marked' para converter
            htmlOutput.innerHTML = marked.parse(markdownText);
        }
    };

    // --- Download como PDF ---
    const downloadPDF = () => {
        if (markdownInput.value.trim() === '') {
            alert('Não há conteúdo para converter para PDF.');
            return;
        }
        
        const element = htmlOutput;
        const now = new Date();
        const filename = `documento-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}.pdf`;

        const opt = {
          margin:       1,
          filename:     filename,
          image:        { type: 'jpeg', quality: 0.98 },
          html2canvas:  { scale: 2, useCORS: true },
          jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        // Utiliza a biblioteca html2pdf para gerar o arquivo
        html2pdf().set(opt).from(element).save();
    };

    // --- Funções de Armazenamento Local (localStorage) ---

    // Carrega os documentos salvos
    const getSavedDocuments = () => {
        return JSON.parse(localStorage.getItem('markdown_docs')) || [];
    };

    // Salva os documentos
    const saveDocuments = (docs) => {
        localStorage.setItem('markdown_docs', JSON.stringify(docs));
    };

    // Renderiza a lista de documentos salvos na tela
    const renderSavedDocuments = () => {
        const docs = getSavedDocuments();
        savedList.innerHTML = ''; // Limpa a lista atual

        if (docs.length === 0) {
            savedList.innerHTML = '<p class="muted-text">Nenhum documento salvo ainda.</p>';
            return;
        }
        
        docs.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'saved-item';
            item.setAttribute('data-id', doc.id);

            item.innerHTML = `
                <span class="item-title" title="Carregar: ${doc.title}">${doc.title}</span>
                <div class="item-actions">
                    <button class="edit-btn" title="Editar Nome">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.5 3.793 12.207 1.5l-1 1zM1 13.5l1.5-1.5L4 13.5 2.5 15H1v-1.5z"/></svg>
                    </button>
                    <button class="delete-btn" title="Excluir Documento">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                    </button>
                </div>
            `;
            savedList.appendChild(item);
        });
    };

    // Função para salvar o documento atual
    const saveCurrentDocument = () => {
        const content = markdownInput.value;
        if (content.trim() === '') {
            alert('Não há conteúdo para salvar.');
            return;
        }

        const title = prompt('Digite um nome para este documento:', 'Novo Documento');
        if (!title || title.trim() === '') {
            return; // Usuário cancelou ou não digitou nada
        }

        const docs = getSavedDocuments();
        const newDoc = {
            id: Date.now().toString(), // ID único baseado no tempo
            title: title.trim(),
            content: content
        };

        docs.push(newDoc);
        saveDocuments(docs);
        renderSavedDocuments();
        alert(`Documento "${newDoc.title}" salvo com sucesso!`);
    };
    
    // Manipulador de cliques na lista de salvos (usando delegação de eventos)
    const handleSavedListClick = (e) => {
        const target = e.target.closest('button');
        if (!target) {
            // Se o clique for no título, carrega o documento
            const itemTitle = e.target.closest('.item-title');
            if (itemTitle) {
                const docId = itemTitle.parentElement.getAttribute('data-id');
                const docs = getSavedDocuments();
                const docToLoad = docs.find(doc => doc.id === docId);
                if (docToLoad) {
                    markdownInput.value = docToLoad.content;
                    convertMarkdown();
                    window.scrollTo(0,0); // Rola a página para o topo
                }
            }
            return;
        }

        const docId = target.closest('.saved-item').getAttribute('data-id');
        let docs = getSavedDocuments();

        // Ação de Editar
        if (target.classList.contains('edit-btn')) {
            const docToEdit = docs.find(doc => doc.id === docId);
            const newTitle = prompt('Digite o novo nome para o documento:', docToEdit.title);
            if (newTitle && newTitle.trim() !== '') {
                docToEdit.title = newTitle.trim();
                saveDocuments(docs);
                renderSavedDocuments();
            }
        }

        // Ação de Excluir
        if (target.classList.contains('delete-btn')) {
            const docToDelete = docs.find(doc => doc.id === docId);
            if (confirm(`Tem certeza que deseja excluir o documento "${docToDelete.title}"?`)) {
                const updatedDocs = docs.filter(doc => doc.id !== docId);
                saveDocuments(updatedDocs);
                renderSavedDocuments();
            }
        }
    };


    // --- Event Listeners ---
    markdownInput.addEventListener('input', convertMarkdown);
    saveBtn.addEventListener('click', saveCurrentDocument);
    pdfBtn.addEventListener('click', downloadPDF);
    savedList.addEventListener('click', handleSavedListClick);
    
    // --- Inicialização ---
    renderSavedDocuments(); // Carrega os documentos salvos ao iniciar a página
});
