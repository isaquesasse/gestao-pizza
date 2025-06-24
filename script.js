document.addEventListener('DOMContentLoaded', () => {

    const JSONBIN_API_KEY = "$2a$10$p/fgndUk/3m.vs8RzYdo3.EvUq50sQByDhOyHnD4q98u520kdINve";
    const JSONBIN_BIN_ID = "685a87e68a456b7966b4aac9";

    const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
    const LOADER = document.getElementById('loader');
    const SAVE_STATUS = document.getElementById('save-status');
    const HEADERS = {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
    };

    let database = {
        ingredientes: [],
        receitas: [],
        estoque: [],
        pedidos: []
    };
    
    let pedidoAtualItems = [];
    let receitaAtualIngredientes = [];
    let originalItemsParaEdicao = [];
    let saveStatusTimeout;
    const chartInstances = {};

    const showLoader = () => LOADER.style.display = 'flex';
    const hideLoader = () => LOADER.style.display = 'none';

    const showSaveStatus = (message, isSuccess = true) => {
        clearTimeout(saveStatusTimeout);
        SAVE_STATUS.textContent = message;
        SAVE_STATUS.className = 'visible';
        if(isSuccess) {
            SAVE_STATUS.classList.add('success');
        }
        
        saveStatusTimeout = setTimeout(() => {
            SAVE_STATUS.className = '';
        }, 3000);
    };

    const loadDataOnline = async () => {
        if (!JSONBIN_API_KEY.includes('COLE') && !JSONBIN_BIN_ID.includes('COLE')) {
            try {
                const response = await fetch(`${JSONBIN_URL}/latest`, { headers: HEADERS, cache: 'no-store' });
                if (response.status === 404) {
                     await saveDataOnline({ isInitial: true });
                } else if (response.ok) {
                    const data = await response.json();
                    if(data.record && Object.keys(data.record).length > 0) {
                        database = data.record;
                    } else {
                        await saveDataOnline({ isInitial: true });
                    }
                } else {
                    const errorData = await response.json();
                    const errorMessage = `Erro ao carregar dados! Status: ${response.status}. Mensagem: ${errorData.message}`;
                    console.error(errorMessage);
                    alert(errorMessage);
                }
            } catch (error) {
                console.error("Falha de conexão ao carregar dados:", error);
                alert("Falha de conexão ao carregar dados. Verifique sua internet.");
            }
        } else {
            alert("Por favor, configure sua chave de API e ID do Bin no arquivo script.js");
        }
    };

    const saveDataOnline = async ({ isInitial = false } = {}) => {
        showLoader();
        if(!isInitial) showSaveStatus('Salvando...', true);
        if (!JSONBIN_API_KEY.includes('COLE') && !JSONBIN_BIN_ID.includes('COLE')) {
            try {
                const response = await fetch(JSONBIN_URL, {
                    method: 'PUT',
                    headers: HEADERS,
                    body: JSON.stringify(database)
                });
                if (response.ok) {
                    if(!isInitial) showSaveStatus('Salvo com sucesso!', true);
                } else {
                    const errorData = await response.json();
                    const errorMessage = `ERRO AO SALVAR!\n\nStatus: ${response.status}\nMensagem: ${errorData.message || 'Erro desconhecido.'}\n\nVerifique suas credenciais no JSONBin.io.`;
                    console.error(errorMessage, errorData);
                    alert(errorMessage);
                    if(!isInitial) showSaveStatus('Falha ao salvar!', false);
                }
            } catch (error) {
                alert("Falha de conexão ao salvar os dados.");
                if(!isInitial) showSaveStatus('Falha na conexão!', false);
            } finally {
                hideLoader();
            }
        } else {
            hideLoader();
        }
    };
    
    const formatCurrency = (value) => {
        if (isNaN(value)) value = 0;
        return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
    }

    const calculatePizzaCost = (pizzaId) => {
        const receita = database.receitas.find(r => r.pizzaId === pizzaId);
        if (!receita || !receita.ingredientes) return 0;
        return receita.ingredientes.reduce((total, itemReceita) => {
            const ingrediente = database.ingredientes.find(i => i.id === itemReceita.ingredienteId);
            return total + (ingrediente ? ingrediente.custo * itemReceita.qtd : 0);
        }, 0);
    };
    
    const renderAll = () => {
        populateSelects();
        renderIngredientes();
        renderEstoque();
        renderReceitas();
        renderPedidos();
        renderDashboard(document.querySelector('.date-filter.active')?.dataset.range || 'all');
        checkAvisos();
    };

    const populateSelects = () => {
        const pizzaEstoqueSelect = document.getElementById('item-pizza');
        const pizzaReceitaSelect = document.getElementById('receita-pizza-select');
        const ingredienteReceitaSelect = document.getElementById('receita-ingrediente-select');
        
        pizzaEstoqueSelect.innerHTML = '<option value="">Selecione a Pizza...</option>';
        database.estoque.forEach(p => {
            const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
            if (p.qtd > 0) {
                pizzaEstoqueSelect.innerHTML += `<option value="${p.id}">${label} (Estoque: ${p.qtd})</option>`;
            }
        });
        pizzaEstoqueSelect.innerHTML += '<option value="outro">Outro...</option>';

        pizzaReceitaSelect.innerHTML = '<option value="">Selecione a Pizza para definir a receita</option>';
        database.estoque.forEach(p => {
            const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
            pizzaReceitaSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
        });

        ingredienteReceitaSelect.innerHTML = '<option value="">Selecione o ingrediente</option>';
        database.ingredientes.forEach(i => ingredienteReceitaSelect.innerHTML += `<option value="${i.id}">${i.nome}</option>`);
    };

    document.querySelectorAll('.tab-link').forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.dataset.tab;
            document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            if (tabId === 'graficos') {
                renderDashboard(document.querySelector('.date-filter.active').dataset.range);
            }
        });
    });

    const renderIngredientes = () => {
        const searchTerm = document.getElementById('search-ingredientes').value.toLowerCase();
        const tbody = document.getElementById('tabela-ingredientes').querySelector('tbody');
        tbody.innerHTML = '';
        const filteredData = database.ingredientes.filter(item => (item.nome || '').toLowerCase().includes(searchTerm));

        filteredData.forEach(item => {
            const row = tbody.insertRow();
            if (item.qtd < item.estoqueMinimo) row.classList.add('low-stock');
            row.innerHTML = `<td data-label="Nome">${item.nome}</td><td data-label="Qtd. em Estoque">${(item.qtd || 0).toFixed(3)}</td><td data-label="Estoque Mínimo">${(item.estoqueMinimo || 0).toFixed(3)}</td><td data-label="Custo (p/ Unidade)">${formatCurrency(item.custo)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="editIngrediente('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="removeIngrediente('${item.id}')">Remover</button></td>`;
        });
    };
    document.getElementById('form-ingrediente').addEventListener('submit', async e => {
        e.preventDefault();
        const id = document.getElementById('ingrediente-id').value;
        const newIngrediente = { nome: document.getElementById('ingrediente-nome').value, qtd: parseFloat(document.getElementById('ingrediente-qtd').value)||0, custo: parseFloat(document.getElementById('ingrediente-custo').value)||0, estoqueMinimo: parseFloat(document.getElementById('ingrediente-estoque-minimo').value)||0 };
        if (id) {
            const index = database.ingredientes.findIndex(i => i.id === id);
            if (index > -1) database.ingredientes[index] = { ...database.ingredientes[index], ...newIngrediente };
        } else {
            database.ingredientes.push({ id: `ing_${Date.now()}`, ...newIngrediente });
        }
        e.target.reset();
        document.getElementById('ingrediente-id').value = '';
        await saveDataOnline();
        renderAll();
    });
    window.editIngrediente = id => {
        const item = database.ingredientes.find(i => i.id === id);
        if (!item) return;
        document.getElementById('ingrediente-id').value = item.id;
        document.getElementById('ingrediente-nome').value = item.nome;
        document.getElementById('ingrediente-qtd').value = item.qtd;
        document.getElementById('ingrediente-custo').value = item.custo;
        document.getElementById('ingrediente-estoque-minimo').value = item.estoqueMinimo;
        document.querySelector('[data-tab="ingredientes"]').scrollIntoView();
    };
    window.removeIngrediente = async id => {
        if (confirm('Remover este ingrediente?')) {
            database.ingredientes = database.ingredientes.filter(i => i.id !== id);
            await saveDataOnline();
            renderAll();
        }
    };
    document.getElementById('search-ingredientes').addEventListener('input', renderIngredientes);

    const renderEstoque = () => {
        const searchTerm = document.getElementById('search-estoque').value.toLowerCase();
        const tbody = document.getElementById('tabela-estoque').querySelector('tbody');
        tbody.innerHTML = '';
        const filteredData = database.estoque.filter(item => (item.nome || '').toLowerCase().includes(searchTerm));

        filteredData.forEach(item => {
            const custo = calculatePizzaCost(item.id);
            const lucro = item.precoVenda - custo;
            const row = tbody.insertRow();
            let pendingDemandHtml = '';
            const pendingOrders = database.pedidos.filter(p => p.status === 'Pendente' && p.items.some(orderItem => orderItem.pizzaId === item.id));
            if (pendingOrders.length > 0) {
                const tooltipList = pendingOrders.map(p => {
                    const relevantItems = p.items.filter(orderItem => orderItem.pizzaId === item.id);
                    return relevantItems.map(ri => `<li>${ri.qtd}x para ${p.cliente}</li>`).join('');
                }).join('');
                pendingDemandHtml = `<span class="stock-demand-warning">🛒<div class="tooltip"><span class="tooltip-title">Pedidos Pendentes:</span><ul>${tooltipList}</ul></div></span>`;
            }
            const saleIndicator = item.history && item.history.some(h => h.type === 'sale') ? '<span class="stock-sale-indicator">↓</span>' : '';
            row.innerHTML = `<td data-label="Sabor da Pizza">${item.nome} ${pendingDemandHtml}</td><td data-label="Tamanho">${item.tamanho||"N/A"}</td><td data-label="Qtd.">${item.qtd} ${saleIndicator}</td><td data-label="Custo Produção">${formatCurrency(custo)}</td><td data-label="Preço Venda">${formatCurrency(item.precoVenda)}</td><td data-label="Lucro Bruto" style="color:${lucro>=0?"green":"red"};font-weight:bold;">${formatCurrency(lucro)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="editEstoque('${item.id}')">Editar</button><button class="action-btn assimilar-btn" onclick="showAssimilarModal('${item.id}')">Assimilar</button><button class="action-btn remove-btn" onclick="removeEstoque('${item.id}')">Remover</button></td>`;
        });
    };
    document.getElementById('form-estoque').addEventListener('submit', async e => {
        e.preventDefault();
        const id = document.getElementById('estoque-id').value;
        const newPizza = { nome: document.getElementById('estoque-nome').value, tamanho: document.getElementById('estoque-tamanho').value, qtd: parseInt(document.getElementById('estoque-qtd').value) || 0, precoVenda: parseFloat(document.getElementById('estoque-preco-venda').value) || 0, history: [] };
        if (id) {
            const index = database.estoque.findIndex(p => p.id === id);
            if(index > -1) {
                newPizza.history = database.estoque[index].history || [];
                newPizza.history.push({ type: 'manual_edit', date: new Date().toISOString() });
                database.estoque[index] = { ...database.estoque[index], ...newPizza };
            }
        } else {
            const newId = `piz_${Date.now()}`;
            newPizza.history.push({ type: 'manual_add', date: new Date().toISOString() });
            const pizzaData = { id: newId, ...newPizza };
            database.estoque.push(pizzaData);
            await reconcileCustomOrders(pizzaData);
        }
        e.target.reset();
        document.getElementById('estoque-id').value = '';
        await saveDataOnline();
        renderAll();
    });
    window.editEstoque = id => {
        const item = database.estoque.find(p => p.id === id);
        if (!item) return;
        document.getElementById('estoque-id').value = item.id;
        document.getElementById('estoque-nome').value = item.nome;
        document.getElementById('estoque-tamanho').value = item.tamanho;
        document.getElementById('estoque-qtd').value = item.qtd;
        document.getElementById('estoque-preco-venda').value = item.precoVenda;
        document.querySelector('[data-tab="estoque"]').scrollIntoView();
    };
    window.removeEstoque = async id => {
        if (confirm('Remover esta pizza? Isso também removerá receitas associadas.')) {
            database.estoque = database.estoque.filter(p => p.id !== id);
            database.receitas = database.receitas.filter(r => r.pizzaId !== id);
            await saveDataOnline();
            renderAll();
        }
    };
    document.getElementById('search-estoque').addEventListener('input', renderEstoque);

    const renderReceitaIngredientesList = () => {
        const container = document.getElementById('receita-ingredientes-list');
        container.innerHTML = '';
        if(receitaAtualIngredientes) {
            receitaAtualIngredientes.forEach((item, index) => {
                const ingrediente = database.ingredientes.find(i => i.id === item.ingredienteId);
                container.innerHTML += `<div class="receita-ingrediente-item"><p><span>${(item.qtd||0).toFixed(3)} x</span> ${ingrediente?ingrediente.nome:"Ingrediente removido"}</p><button type="button" class="btn-remove-item" onclick="removeIngredienteDaReceita(${index})">X</button></div>`;
            });
        }
    };
    const renderReceitas = () => {
        const searchTerm = document.getElementById('search-receitas').value.toLowerCase();
        const tbody = document.getElementById('tabela-receitas').querySelector('tbody');
        tbody.innerHTML = '';
        const filteredData = database.receitas.filter(receita => {
            const pizza = database.estoque.find(p => p.id === receita.pizzaId);
            if (!pizza) return false;
            const nomePizza = (`${pizza.nome} (${pizza.tamanho || ''})`).toLowerCase();
            return nomePizza.includes(searchTerm);
        });
        filteredData.forEach(receita => {
            const pizza = database.estoque.find(p => p.id === receita.pizzaId);
            if (!pizza) return;
            const ingredientesList = receita.ingredientes.map(item => {
                const ingrediente = database.ingredientes.find(i => i.id === item.ingredienteId);
                return ingrediente ? `${(item.qtd||0).toFixed(3)} de ${ingrediente.nome}` : 'item inválido';
            }).join(', ');
            const custoTotal = calculatePizzaCost(pizza.id);
            const row = tbody.insertRow();
            row.innerHTML = `<td data-label="Pizza">${pizza.nome} (${pizza.tamanho||''})</td><td data-label="Ingredientes"><small>${ingredientesList}</small></td><td data-label="Custo Total">${formatCurrency(custoTotal)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="editReceita('${receita.pizzaId}')">Editar</button><button class="action-btn remove-btn" onclick="removeReceita('${receita.pizzaId}')">Remover</button></td>`;
        });
    };
    document.getElementById('receita-pizza-select').addEventListener('change', e => {
        const pizzaId = e.target.value;
        const receitaExistente = database.receitas.find(r => r.pizzaId === pizzaId);
        receitaAtualIngredientes = receitaExistente ? [...(receitaExistente.ingredientes || [])] : [];
        renderReceitaIngredientesList();
    });
    document.getElementById('btn-add-ingrediente-receita').addEventListener('click', () => {
        const ingredienteId = document.getElementById('receita-ingrediente-select').value;
        const qtd = parseFloat(document.getElementById('receita-ingrediente-qtd').value);
        if (!ingredienteId || !qtd) {
            alert('Selecione um ingrediente e defina a quantidade.');
            return;
        }
        receitaAtualIngredientes.push({ ingredienteId, qtd });
        renderReceitaIngredientesList();
        document.getElementById('receita-ingrediente-select').value = '';
        document.getElementById('receita-ingrediente-qtd').value = '';
    });
    window.removeIngredienteDaReceita = index => {
        receitaAtualIngredientes.splice(index, 1);
        renderReceitaIngredientesList();
    };
    document.getElementById('btn-salvar-receita').addEventListener('click', async () => {
        const pizzaId = document.getElementById('receita-pizza-select').value;
        if (!pizzaId) {
            alert('Selecione uma pizza para salvar a receita.');
            return;
        }
        const index = database.receitas.findIndex(r => r.pizzaId === pizzaId);
        const ingredientesCopiados = [...receitaAtualIngredientes];
        if (index > -1) {
            database.receitas[index].ingredientes = ingredientesCopiados;
        } else {
            database.receitas.push({ pizzaId, ingredientes: ingredientesCopiados });
        }
        receitaAtualIngredientes = [];
        renderReceitaIngredientesList();
        document.getElementById('form-receita').reset();
        document.getElementById('receita-ingrediente-select').value = '';
        document.getElementById('receita-ingrediente-qtd').value = '';
        await saveDataOnline();
        renderAll();
    });
    window.editReceita = pizzaId => {
        document.getElementById('receita-pizza-select').value = pizzaId;
        document.getElementById('receita-pizza-select').dispatchEvent(new Event('change'));
        document.querySelector('[data-tab="receitas"]').scrollIntoView();
    };
    window.removeReceita = async pizzaId => {
        if (confirm('Tem certeza que deseja remover esta receita?')) {
            database.receitas = database.receitas.filter(r => r.pizzaId !== pizzaId);
            await saveDataOnline();
            renderAll();
        }
    };
    document.getElementById('search-receitas').addEventListener('input', renderReceitas);

    const renderPedidoCarrinho = () => {
        const container = document.getElementById('pedido-itens-carrinho');
        container.innerHTML = '';
        if (pedidoAtualItems.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#777">Nenhuma pizza adicionada ao pedido.</p>';
            return;
        }
        pedidoAtualItems.forEach((item, index) => {
            container.innerHTML += `<div class="carrinho-item"><p><span style="color:#3498db">${item.qtd}x</span> ${item.pizzaNome} ${item.isCustom?'<b class="item-pedido-outro">(Outro)</b>':""}</p><button type="button" class="btn-remove-item" onclick="removeItemPedido(${index})">X</button></div>`;
        });
    };
    document.getElementById('item-pizza').addEventListener('change', e => {
        const outroNome = document.getElementById('item-pizza-outro-nome');
        const outroTamanho = document.getElementById('item-pizza-outro-tamanho');
        if (e.target.value === 'outro') {
            outroNome.classList.remove('hidden');
            outroTamanho.classList.remove('hidden');
        } else {
            outroNome.classList.add('hidden');
            outroTamanho.classList.add('hidden');
        }
    });
    document.getElementById('btn-add-item-pedido').addEventListener('click', () => {
        const pizzaSelect = document.getElementById('item-pizza');
        const pizzaId = pizzaSelect.value;
        const qtd = parseInt(document.getElementById('item-qtd').value);
        if (!pizzaId || !qtd || qtd < 1) {
            alert('Selecione uma pizza e informe uma quantidade válida.');
            return;
        }
        let pizzaNome, isCustom = false;
        if (pizzaId === 'outro') {
            pizzaNome = document.getElementById('item-pizza-outro-nome').value.trim();
            if (!pizzaNome) {
                alert('Por favor, informe o nome da pizza.');
                return;
            }
            const tamanho = document.getElementById('item-pizza-outro-tamanho').value;
            pizzaNome = `${pizzaNome} (${tamanho})`;
            isCustom = true;
        } else {
            const pizzaData = database.estoque.find(p => p.id === pizzaId);
            pizzaNome = pizzaData.tamanho ? `${pizzaData.nome} (${pizzaData.tamanho})` : pizzaData.nome;
        }
        pedidoAtualItems.push({ pizzaId, pizzaNome, qtd, isCustom });
        renderPedidoCarrinho();
        pizzaSelect.value = '';
        document.getElementById('item-qtd').value = '';
        document.getElementById('item-pizza-outro-nome').value = '';
        document.getElementById('item-pizza-outro-nome').classList.add('hidden');
        document.getElementById('item-pizza-outro-tamanho').classList.add('hidden');
    });
    window.removeItemPedido = index => {
        pedidoAtualItems.splice(index, 1);
        renderPedidoCarrinho();
    };
    
    const BOTOES_ACAO = document.getElementById('pedido-botoes-acao');
    const BTN_REGISTRAR = document.getElementById('btn-registrar-pedido');

    const setupBotaoPedido = () => {
        const editId = document.getElementById('pedido-edit-id').value;
        if (editId) {
            BTN_REGISTRAR.textContent = 'Salvar Alterações';
            if (!document.getElementById('btn-cancelar-edicao')) {
                const cancelButton = document.createElement('button');
                cancelButton.type = 'button';
                cancelButton.id = 'btn-cancelar-edicao';
                cancelButton.className = 'remove-btn';
                cancelButton.textContent = 'Cancelar Edição';
                cancelButton.onclick = cancelEditPedido;
                BOTOES_ACAO.appendChild(cancelButton);
            }
        } else {
            BTN_REGISTRAR.textContent = 'Registrar Pedido Completo';
            const cancelButton = document.getElementById('btn-cancelar-edicao');
            if (cancelButton) {
                cancelButton.remove();
            }
        }
    };
    
    BTN_REGISTRAR.addEventListener('click', async () => {
        const editId = document.getElementById('pedido-edit-id').value;
        if (editId) {
            await salvarPedidoEditado(editId);
        } else {
            await registrarNovoPedido();
        }
    });

    const registrarNovoPedido = async () => {
        if (pedidoAtualItems.length === 0) { alert('Adicione pelo menos uma pizza ao pedido.'); return; }
        const cliente = document.getElementById('pedido-cliente').value;
        const vendedor = document.getElementById('pedido-vendedor').value;
        const cidade = document.getElementById('pedido-cidade').value;
        const pagamento = document.getElementById('pedido-pagamento').value;
        if (!cliente || !pagamento || !vendedor || !cidade) { alert('Preencha nome do cliente, vendedor, cidade e forma de pagamento.'); return; }

        const newPedido = { id: `ped_${Date.now()}`, cliente, telefone: document.getElementById('pedido-cliente-telefone').value, vendedor, cidade, pagamento, data: new Date().toISOString(), status: 'Pendente', items: pedidoAtualItems.map(item => { if (item.isCustom) return { ...item, custo: 0, preco: 0 }; const pizzaData = database.estoque.find(p => p.id === item.pizzaId); const custo = pizzaData ? calculatePizzaCost(pizzaData.id) : 0; const preco = pizzaData ? pizzaData.precoVenda : 0; return { ...item, custo, preco }; })};
        newPedido.valorTotal = newPedido.items.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        newPedido.custoTotal = newPedido.items.reduce((acc, item) => acc + (item.custo * item.qtd), 0);
        newPedido.lucro = newPedido.valorTotal - newPedido.custoTotal;
        newPedido.items.forEach(item => { if (!item.isCustom) { const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId); if (pizzaEstoque) { pizzaEstoque.qtd -= item.qtd; if(!pizzaEstoque.history) pizzaEstoque.history = []; pizzaEstoque.history.push({ type: 'sale', date: new Date().toISOString(), orderId: newPedido.id }); } }});
        
        database.pedidos.push(newPedido);
        pedidoAtualItems = [];
        document.getElementById('form-pedido-principal').reset();
        document.getElementById('pedido-itens-carrinho').innerHTML = '';
        await saveDataOnline();
        renderAll();
    };

    const salvarPedidoEditado = async (editId) => {
        const pedidoIndex = database.pedidos.findIndex(p => p.id === editId);
        if (pedidoIndex === -1) { alert("Erro: Pedido não encontrado para edição."); return; }
        
        const originalItems = originalItemsParaEdicao;
        originalItems.forEach(item => {
            if (!item.isCustom) {
                const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                if (pizzaEstoque) {
                    pizzaEstoque.qtd += item.qtd;
                    if (!pizzaEstoque.history) pizzaEstoque.history = [];
                    pizzaEstoque.history.push({ type: 'edit_return', date: new Date().toISOString(), orderId: editId });
                }
            }
        });

        const updatedPedido = database.pedidos[pedidoIndex];
        updatedPedido.cliente = document.getElementById('pedido-cliente').value;
        updatedPedido.telefone = document.getElementById('pedido-cliente-telefone').value;
        updatedPedido.vendedor = document.getElementById('pedido-vendedor').value;
        updatedPedido.cidade = document.getElementById('pedido-cidade').value;
        updatedPedido.pagamento = document.getElementById('pedido-pagamento').value;
        updatedPedido.items = pedidoAtualItems.map(item => { if (item.isCustom) return { ...item, custo: 0, preco: 0 }; const pizzaData = database.estoque.find(p => p.id === item.pizzaId); const custo = pizzaData ? calculatePizzaCost(pizzaData.id) : 0; const preco = pizzaData ? pizzaData.precoVenda : 0; return { ...item, custo, preco }; });
        
        updatedPedido.valorTotal = updatedPedido.items.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        updatedPedido.custoTotal = updatedPedido.items.reduce((acc, item) => acc + (item.custo * item.qtd), 0);
        updatedPedido.lucro = updatedPedido.valorTotal - updatedPedido.custoTotal;
        
        updatedPedido.items.forEach(item => { if (!item.isCustom) { const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId); if (pizzaEstoque) { pizzaEstoque.qtd -= item.qtd; if(!pizzaEstoque.history) pizzaEstoque.history = []; pizzaEstoque.history.push({ type: 'sale_after_edit', date: new Date().toISOString(), orderId: editId }); } } });
        
        await saveDataOnline();
        cancelEditPedido(); 
    };

    window.editPedido = (id) => {
        const pedido = database.pedidos.find(p => p.id === id);
        if(!pedido || pedido.status !== 'Pendente') { alert('Apenas pedidos pendentes podem ser editados.'); return; }
        
        document.getElementById('pedido-edit-id').value = id;
        document.getElementById('pedido-cliente').value = pedido.cliente;
        document.getElementById('pedido-cliente-telefone').value = pedido.telefone;
        document.getElementById('pedido-vendedor').value = pedido.vendedor;
        document.getElementById('pedido-cidade').value = pedido.cidade;
        document.getElementById('pedido-pagamento').value = pedido.pagamento;
        
        pedidoAtualItems = JSON.parse(JSON.stringify(pedido.items));
        originalItemsParaEdicao = JSON.parse(JSON.stringify(pedido.items));
        renderPedidoCarrinho();
        setupBotaoPedido();
        document.querySelector('[data-tab="pedidos"]').scrollIntoView();
    };

    const cancelEditPedido = () => {
        document.getElementById('form-pedido-principal').reset();
        document.getElementById('pedido-edit-id').value = '';
        pedidoAtualItems = [];
        originalItemsParaEdicao = [];
        renderPedidoCarrinho();
        setupBotaoPedido();
        renderAll();
    };

    const renderPedidos = () => {
        const searchTerm = document.getElementById('search-pedidos').value.toLowerCase();
        const tbody = document.getElementById('tabela-pedidos').querySelector('tbody');
        tbody.innerHTML = '';
        const filteredData = database.pedidos.filter(p => {
            if (!searchTerm) return true;
            const search = searchTerm.trim();
            const hasCliente = (p.cliente || '').toLowerCase().includes(search);
            const hasTelefone = (p.telefone || '').toLowerCase().includes(search);
            const hasVendedor = (p.vendedor || '').toLowerCase().includes(search);
            const hasItem = p.items.some(i => (i.pizzaNome || '').toLowerCase().includes(search));
            return hasCliente || hasTelefone || hasVendedor || hasItem;
        });
        filteredData.sort((a,b) => new Date(b.data) - new Date(a.data)).forEach(p => {
            const row = tbody.insertRow();
            const itemsHtml = p.items.map(i => `<li class="${i.isCustom?'item-pedido-outro':''}">${i.qtd}x ${i.pizzaNome}</li>`).join('');
            let acoesHtml = `${p.status==='Pendente'?`<button class="action-btn edit-btn" onclick="editPedido('${p.id}')">Editar</button><button class="action-btn complete-btn" onclick="concluirPedido('${p.id}')">Concluir</button>`:''}<button class="action-btn remove-btn" onclick="removerPedido('${p.id}')">Remover</button>`;
            row.innerHTML = `<td data-label="Cliente">${p.cliente}</b><br><small>${p.telefone||"N/A"}</small></td><td data-label="Itens"><ul style="padding-left:15px;margin:0">${itemsHtml}</ul></td><td data-label="Detalhes"><small>Vend.: ${p.vendedor}<br>Cid.: ${p.cidade}<br>Pag.: ${p.pagamento}</small></td><td data-label="Valores"><b>Total: ${formatCurrency(p.valorTotal)}</b><br><small>Custo: ${formatCurrency(p.custoTotal)}</small><br><b style="color:${p.lucro>=0?"green":"red"}">${p.lucro>=0?"+":""}${formatCurrency(p.lucro)}</b></td><td data-label="Status"><span class="status-${p.status.toLowerCase()}">${p.status}</span></td><td data-label="Ações">${acoesHtml}</td>`;
        });
    };
    window.concluirPedido = async id => {
        const pedido = database.pedidos.find(p => p.id === id);
        if (pedido) {
            pedido.status = 'Concluído';
            await saveDataOnline();
            renderAll();
        }
    };
    window.removerPedido = async id => {
        const pedidoIndex = database.pedidos.findIndex(p => p.id === id);
        if (pedidoIndex > -1) {
            const pedidoParaRemover = database.pedidos[pedidoIndex];
            if (confirm(`Tem certeza que deseja remover o pedido de ${pedidoParaRemover.cliente}?`)) {
                if(pedidoParaRemover.status === 'Pendente') {
                    pedidoParaRemover.items.forEach(item => {
                        if(!item.isCustom) {
                            const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                            if(pizzaEstoque) {
                                pizzaEstoque.qtd += item.qtd;
                                if(!pizzaEstoque.history) pizzaEstoque.history = [];
                                pizzaEstoque.history.push({ type: 'cancellation_return', date: new Date().toISOString(), orderId: id });
                            }
                        }
                    });
                }
                database.pedidos.splice(pedidoIndex, 1);
                await saveDataOnline();
                renderAll();
            }
        }
    };
    document.getElementById('search-pedidos').addEventListener('input', renderPedidos);

    const checkAvisos = () => {
        const pedidosTab = document.querySelector('[data-tab="pedidos"]');
        const estoqueTab = document.querySelector('[data-tab="estoque"]');
        pedidosTab.classList.remove('has-warning');
        estoqueTab.classList.remove('has-warning');
        const customItemsPendentes = database.pedidos.some(p => p.status === 'Pendente' && p.items.some(i => i.isCustom));
        if (customItemsPendentes) {
            pedidosTab.classList.add('has-warning');
            estoqueTab.classList.add('has-warning');
        }
    };

    const reconcileCustomOrders = async (newlyAddedPizza) => {
        let pizzaChanged = false;
        const pizzaNameToMatch = newlyAddedPizza.tamanho ? `${newlyAddedPizza.nome} (${newlyAddedPizza.tamanho})` : newlyAddedPizza.nome;
        database.pedidos.filter(p => p.status === 'Pendente').forEach(pedido => {
            let pedidoUpdated = false;
            pedido.items.forEach(item => {
                if (item.isCustom && item.pizzaNome === pizzaNameToMatch && newlyAddedPizza.qtd >= item.qtd) {
                    newlyAddedPizza.qtd -= item.qtd;
                    item.isCustom = false;
                    item.pizzaId = newlyAddedPizza.id;
                    item.custo = calculatePizzaCost(newlyAddedPizza.id);
                    item.preco = newlyAddedPizza.precoVenda;
                    pizzaChanged = true;
                    pedidoUpdated = true;
                }
            });
            if (pedidoUpdated) {
                 pedido.valorTotal = pedido.items.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
                 pedido.custoTotal = pedido.items.reduce((acc, item) => acc + (item.custo * item.qtd), 0);
                 pedido.lucro = pedido.valorTotal - pedido.custoTotal;
            }
        });
        if (pizzaChanged) {
            alert('Um ou mais pedidos pendentes foram automaticamente vinculados à nova pizza em estoque!');
            await saveDataOnline();
            renderAll();
        }
    };
    
    window.showAssimilarModal = (stockPizzaId) => {
        const listaContainer = document.getElementById('assimilar-lista-pedidos');
        listaContainer.innerHTML = '';
        const customItems = [];
        database.pedidos.filter(p => p.status === 'Pendente').forEach((pedido) => {
            pedido.items.forEach((item, itemIndex) => {
                if(item.isCustom) customItems.push({pedido, item, itemIndex});
            });
        });
        if (customItems.length === 0) {
            listaContainer.innerHTML = '<p>Nenhum pedido "Outro" pendente para assimilar.</p>';
        } else {
            customItems.forEach(({pedido, item, itemIndex}) => {
                listaContainer.innerHTML += `<div class="carrinho-item"><span>Pedido de <b>${pedido.cliente}</b>: ${item.qtd}x "${item.pizzaNome}"</span><button class="action-btn" onclick="assimilateOrderItem('${pedido.id}', ${itemIndex}, '${stockPizzaId}')">Assimilar</button></div>`;
            });
        }
        document.getElementById('modal-assimilar').style.display = 'block';
    };

    window.assimilateOrderItem = async (pedidoId, itemIndex, stockPizzaId) => {
        const pedido = database.pedidos.find(p => p.id === pedidoId);
        const stockPizza = database.estoque.find(p => p.id === stockPizzaId);
        const item = pedido.items[itemIndex];
        if (stockPizza.qtd < item.qtd) {
            alert(`Estoque insuficiente de ${stockPizza.nome}. Apenas ${stockPizza.qtd} em estoque.`);
            return;
        }
        stockPizza.qtd -= item.qtd;
        if (!stockPizza.history) stockPizza.history = [];
        stockPizza.history.push({ type: 'sale', date: new Date().toISOString(), orderId: pedido.id });
        item.isCustom = false;
        item.pizzaId = stockPizza.id;
        item.pizzaNome = stockPizza.tamanho ? `${stockPizza.nome} (${stockPizza.tamanho})` : stockPizza.nome;
        item.custo = calculatePizzaCost(stockPizza.id);
        item.preco = stockPizza.precoVenda;
        pedido.valorTotal = pedido.items.reduce((acc, i) => acc + ((i.preco || 0) * (i.qtd || 0)), 0);
        pedido.custoTotal = pedido.items.reduce((acc, i) => acc + ((i.custo || 0) * (i.qtd || 0)), 0);
        pedido.lucro = pedido.valorTotal - pedido.custoTotal;
        alert('Pedido assimilado com sucesso!');
        closeModal('modal-assimilar');
        await saveDataOnline();
        renderAll();
    };

    window.closeModal = (modalId) => { document.getElementById(modalId).style.display = 'none'; };

    const getFilteredPedidos = (filterRange = 'all') => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1) ); 
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return database.pedidos.filter(p => {
            if (p.status !== 'Concluído') return false;
            const pDate = new Date(p.data);
            switch (filterRange) {
                case 'today': return pDate >= today;
                case 'week': return pDate >= weekStart;
                case 'month': return pDate >= monthStart;
                case 'all': default: return true;
            }
        });
    };

    const renderDashboard = (filterRange = 'all') => {
        Object.values(chartInstances).forEach(chart => { if(chart && typeof chart.destroy === 'function') chart.destroy() });
        const filteredPedidos = getFilteredPedidos(filterRange);
        renderBalancoChart(filteredPedidos);
        renderPizzasMaisLucrativasChart(filteredPedidos);
        renderVendasPorVendedorChart(filteredPedidos);
        renderPizzasMaisVendidasChart(filteredPedidos);
        renderVendasPorDiaChart(filteredPedidos);
    };
    
    const renderBalancoChart=(t)=>{const e=t.reduce((t,e)=>t+e.valorTotal,0),a=t.reduce((t,e)=>t+e.custoTotal,0),r=t.reduce((t,e)=>t+e.lucro,0),o=document.getElementById("balancoChart").getContext("2d");chartInstances.balanco=new Chart(o,{type:"bar",data:{labels:["Balanço Financeiro"],datasets:[{label:"Receita Total",data:[e],backgroundColor:"#2ecc71",borderWidth:1},{label:"Custo Total",data:[a],backgroundColor:"#e74c3c",borderWidth:1},{label:"Lucro Total",data:[r],backgroundColor:"#3498db",borderWidth:1}]},options:{indexAxis:"y",responsive:!0,scales:{x:{ticks:{callback:t=>formatCurrency(t)}}}}})};
    const renderPizzasMaisLucrativasChart=(t)=>{const e=t.flatMap(t=>t.items).reduce((t,e)=>{if(e.isCustom)return t;const a=(e.preco-e.custo)*e.qtd;return t[e.pizzaNome]=(t[e.pizzaNome]||0)+a,t},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("pizzasMaisLucrativasChart").getContext("2d");chartInstances.lucro=new Chart(o,{type:"doughnut",data:{labels:a,datasets:[{data:r,backgroundColor:["#2ecc71","#3498db","#9b59b6","#f1c40f","#e67e22","#1abc9c"]}]},options:{responsive:!0,plugins:{legend:{position:"top"},tooltip:{callbacks:{label:t=>`${t.label}: ${formatCurrency(t.raw)}`}}}}})};
    const renderVendasPorVendedorChart=(t)=>{const e=t.reduce((t,e)=>{if(e.vendedor)t[e.vendedor]=(t[e.vendedor]||0)+e.valorTotal;return t},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("vendasPorVendedorChart").getContext("2d");chartInstances.vendedor=new Chart(o,{type:"bar",data:{labels:a,datasets:[{label:"Total Vendido",data:r,backgroundColor:"#487eb0"}]},options:{responsive:!0,scales:{y:{ticks:{callback:t=>formatCurrency(t)}}}}})};
    const renderPizzasMaisVendidasChart=(t)=>{const e=t.flatMap(t=>t.items).reduce((t,e)=>{return e.isCustom?t:(t[e.pizzaNome]=(t[e.pizzaNome]||0)+e.qtd,t)},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("pizzasMaisVendidasChart").getContext("2d");chartInstances.vendas=new Chart(o,{type:"pie",data:{labels:a,datasets:[{data:r,backgroundColor:["#e74c3c","#3498db","#f1c40f","#2ecc71","#9b59b6","#1abc9c"]}]},options:{responsive:!0,plugins:{legend:{position:"top"}}}})};
    const renderVendasPorDiaChart=(t)=>{const e=t.reduce((t,e)=>{const a=new Date(e.data).toLocaleDateString("pt-BR");return t[a]=(t[a]||0)+e.valorTotal,t},{}),a=Object.keys(e).sort((t,a)=>new Date(t.split("/").reverse().join("-"))-new Date(a.split("/").reverse().join("-"))),r=a.map(t=>e[t]),o=document.getElementById("vendasPorDiaChart").getContext("2d");chartInstances.dia=new Chart(o,{type:"line",data:{labels:a,datasets:[{label:"Receita por Dia",data:r,borderColor:"#2c3e50",tension:.1,fill:!1}]},options:{responsive:!0,scales:{y:{ticks:{callback:t=>formatCurrency(t)}}}}})};

    document.querySelectorAll('.date-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDashboard(btn.dataset.range);
        });
    });

    const exportToExcel = (data, filename) => {
        if (!data || data.length === 0) {
            alert("Não há dados para exportar.");
            return;
        }
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Dados');
        XLSX.writeFile(workbook, `${filename}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`);
    };

    document.getElementById('export-ingredientes').addEventListener('click', () => exportToExcel(database.ingredientes, 'sasses_ingredientes'));
    document.getElementById('export-estoque').addEventListener('click', () => {
        const data = database.estoque.map(p => ({ "Pizza": p.nome, "Tamanho": p.tamanho, "Quantidade": p.qtd, "Preco de Venda": p.precoVenda, "Custo de Produção": calculatePizzaCost(p.id), "Lucro por Unidade": p.precoVenda - calculatePizzaCost(p.id) }));
        exportToExcel(data, 'sasses_estoque_financeiro');
    });
    document.getElementById('export-receitas').addEventListener('click', () => {
        const data = database.receitas.map(r => {
            const pizza = database.estoque.find(p => p.id === r.pizzaId);
            return { "Pizza": pizza ? `${pizza.nome} (${pizza.tamanho || ''})` : 'Pizza Removida', "Ingredientes": r.ingredientes.map(i => { const ingrediente = database.ingredientes.find(ing => ing.id === i.ingredienteId); return `${i.qtd} de ${ingrediente ? ingrediente.nome : 'N/A'}`; }).join('; '), "Custo Total da Receita": calculatePizzaCost(r.pizzaId) };
        });
        exportToExcel(data, 'sasses_receitas');
    });
    document.getElementById('export-pedidos').addEventListener('click', () => {
        const flatData = [];
        database.pedidos.forEach(p => {
            if (p.items && p.items.length > 0) {
                p.items.forEach(item => {
                    flatData.push({ "ID Pedido": p.id, "Cliente": p.cliente, "Telefone": p.telefone, "Vendedor": p.vendedor, "Cidade": p.cidade, "Data": new Date(p.data).toLocaleString('pt-BR'), "Status": p.status, "Pagamento": p.pagamento, "Item Pizza": item.pizzaNome, "Item Qtd": item.qtd, "Item é Custom?": item.isCustom ? 'Sim' : 'Não', "Valor Total Pedido": p.valorTotal, "Custo Total Pedido": p.custoTotal, "Lucro Total Pedido": p.lucro });
                });
            }
        });
        exportToExcel(flatData, 'sasses_pedidos_detalhado');
    });
    
    const startApp = async () => {
        await loadDataOnline();
        renderAll();
        hideLoader();
    };

    startApp();
});