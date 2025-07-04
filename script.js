document.addEventListener('DOMContentLoaded', () => {

    const SUPABASE_URL = 'https://iprnfzevdfmnraexthpy.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlwcm5memV2ZGZtbnJhZXh0aHB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2NTE1NTAsImV4cCI6MjA2NzIyNzU1MH0.h5Omsd0XsRtAmOErRCpaqg91OkF53lB8WE9dYlVdRbo';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const LOADER = document.getElementById('loader');
    const SAVE_STATUS = document.getElementById('save-status');

    let database = {
        ingredientes: [],
        receitas: [],
        estoque: [],
        pedidos: [],
        clientes: []
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
        if (isSuccess) {
            SAVE_STATUS.classList.add('success');
        }

        saveStatusTimeout = setTimeout(() => {
            SAVE_STATUS.className = '';
        }, 3000);
    };

    const loadDataFromSupabase = async () => {
        showLoader();
        try {
            const [
                { data: ingredientes, error: errIng },
                { data: estoque, error: errEst },
                { data: receitas, error: errRec },
                { data: pedidos, error: errPed }
            ] = await Promise.all([
                supabaseClient.from('ingredientes').select('*').order('nome'),
                supabaseClient.from('estoque').select('*').order('nome'),
                supabaseClient.from('receitas').select('*'),
                supabaseClient.from('pedidos').select('*').order('data', { ascending: false })
            ]);

            if (errIng || errEst || errRec || errPed) {
                throw new Error(errIng?.message || errEst?.message || errRec?.message || errPed?.message);
            }

            database.ingredientes = ingredientes || [];
            database.estoque = estoque || [];
            database.receitas = receitas || [];
            database.pedidos = pedidos || [];
            
            processCustomerData();
            renderAll();
        } catch (error) {
            console.error("Erro ao carregar dados do Supabase:", error);
            alert("Falha ao carregar dados. Verifique sua conexão e as configurações do Supabase.");
        } finally {
            hideLoader();
        }
    };
    
    const toggleAdminView = () => {
        const body = document.body;
        const btn = document.getElementById('btn-admin-view');
        
        if (body.classList.contains('admin-mode')) {
            body.classList.remove('admin-mode');
            btn.textContent = 'Visão ADM';
            
            const activeTabIsAdminOnly = document.querySelector('.tab-link.active.admin-only');
            if (activeTabIsAdminOnly) {
                document.querySelector('.tab-link[data-tab="pedidos"]').click();
            }

        } else {
            const password = prompt('Digite a senha de administrador:');
            if (password === 'sasse') {
                body.classList.add('admin-mode');
                btn.textContent = 'Sair da Visão ADM';
            } else if (password) {
                alert('Senha incorreta!');
            }
        }
    };

    document.getElementById('btn-admin-view').addEventListener('click', toggleAdminView);

    const formatCurrency = (value) => {
        if (isNaN(value) || value === null) value = 0;
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
        renderClientesReport();
        renderDashboard(document.querySelector('.date-filter.active')?.dataset.range || 'all');
    };

    const populateSelects = () => {
        const pizzaEstoqueSelect = document.getElementById('item-pizza');
        const pizzaReceitaSelect = document.getElementById('receita-pizza-select');
        const ingredienteReceitaSelect = document.getElementById('receita-ingrediente-select');
        const producaoPizzaSelect = document.getElementById('producao-pizza-select');

        pizzaEstoqueSelect.innerHTML = '<option value="">Selecione a Pizza...</option>';
        producaoPizzaSelect.innerHTML = '<option value="">Selecione a Pizza a Produzir...</option>';
        pizzaReceitaSelect.innerHTML = '<option value="">Selecione a Pizza para definir a receita</option>';
        
        database.estoque.forEach(p => {
            const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
            if (p.qtd > 0) {
                pizzaEstoqueSelect.innerHTML += `<option value="${p.id}">${label} (Estoque: ${p.qtd})</option>`;
            }
            producaoPizzaSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
            pizzaReceitaSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
        });
        pizzaEstoqueSelect.innerHTML += '<option value="outro">Outro...</option>';

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
            row.innerHTML = `<td data-label="Nome">${item.nome}</td><td data-label="Qtd. em Estoque">${(item.qtd || 0).toFixed(3)}</td><td data-label="Estoque Mínimo">${(item.estoqueMinimo || 0).toFixed(3)}</td><td data-label="Custo (p/ Unidade)" class="admin-only">${formatCurrency(item.custo)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="editIngrediente('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="removeIngrediente('${item.id}')">Remover</button></td>`;
        });
        
        const thCusto = document.querySelector('#tabela-ingredientes th:nth-child(4)');
        if(thCusto) thCusto.classList.add('admin-only');
    };

    document.getElementById('form-ingrediente').addEventListener('submit', async e => {
        e.preventDefault();
        showLoader();
        const id = document.getElementById('ingrediente-id').value;
        const newIngrediente = {
            nome: document.getElementById('ingrediente-nome').value,
            qtd: parseFloat(document.getElementById('ingrediente-qtd').value) || 0,
            custo: parseFloat(document.getElementById('ingrediente-custo').value) || 0,
            estoqueMinimo: parseFloat(document.getElementById('ingrediente-estoque-minimo').value) || 0
        };

        let error;
        if (id) {
            ({ error } = await supabaseClient.from('ingredientes').update(newIngrediente).eq('id', id));
        } else {
            ({ error } = await supabaseClient.from('ingredientes').insert(newIngrediente));
        }

        if (error) {
            alert('Erro ao salvar ingrediente: ' + error.message);
        } else {
            showSaveStatus('Ingrediente salvo!');
            e.target.reset();
            document.getElementById('ingrediente-id').value = '';
            await loadDataFromSupabase();
        }
        hideLoader();
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
            showLoader();
            const { error } = await supabaseClient.from('ingredientes').delete().eq('id', id);
            if (error) {
                alert('Erro ao remover: ' + error.message);
            } else {
                await loadDataFromSupabase();
            }
            hideLoader();
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
            const saleIndicator = item.history && item.history.some(h => h.type === 'sale') ? '<span class="stock-sale-indicator">↓</span>' : '';
            row.innerHTML = `<td data-label="Sabor da Pizza">${item.nome}</td><td data-label="Tamanho">${item.tamanho||"N/A"}</td><td data-label="Qtd.">${item.qtd} ${saleIndicator}</td><td data-label="Custo Produção" class="admin-only">${formatCurrency(custo)}</td><td data-label="Preço Venda">${formatCurrency(item.precoVenda)}</td><td data-label="Lucro Bruto" class="admin-only" style="color:${lucro>=0?"green":"red"};font-weight:bold;">${formatCurrency(lucro)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="editEstoque('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="removeEstoque('${item.id}')">Remover</button></td>`;
        });
    };

    document.getElementById('form-estoque').addEventListener('submit', async e => {
        e.preventDefault();
        showLoader();
        const id = document.getElementById('estoque-id').value;
        const pizzaData = {
            nome: document.getElementById('estoque-nome').value,
            tamanho: document.getElementById('estoque-tamanho').value,
            qtd: parseInt(document.getElementById('estoque-qtd').value) || 0,
            precoVenda: parseFloat(document.getElementById('estoque-preco-venda').value) || 0,
        };

        let error;
        if (id) {
            const existingPizza = database.estoque.find(p => p.id === id);
            pizzaData.history = existingPizza.history || [];
            pizzaData.history.push({ type: 'manual_edit', date: new Date().toISOString() });
            ({ error } = await supabaseClient.from('estoque').update(pizzaData).eq('id', id));
        } else {
            pizzaData.history = [{ type: 'manual_add', date: new Date().toISOString() }];
            ({ error } = await supabaseClient.from('estoque').insert(pizzaData));
        }

        if (error) {
            alert('Erro ao salvar pizza: ' + error.message);
        } else {
            showSaveStatus('Pizza salva!');
            e.target.reset();
            document.getElementById('estoque-id').value = '';
            await loadDataFromSupabase();
        }
        hideLoader();
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
            showLoader();
            const { error } = await supabaseClient.from('estoque').delete().eq('id', id);
            if (error) {
                alert('Erro ao remover pizza: ' + error.message);
            } else {
                await loadDataFromSupabase();
            }
            hideLoader();
        }
    };

    document.getElementById('search-estoque').addEventListener('input', renderEstoque);

    const renderReceitaIngredientesList = () => {
        const container = document.getElementById('receita-ingredientes-list');
        container.innerHTML = '';
        if (receitaAtualIngredientes) {
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
            const ingredientesList = receita.ingredientes?.map(item => {
                const ingrediente = database.ingredientes.find(i => i.id === item.ingredienteId);
                return ingrediente ? `${(item.qtd||0).toFixed(3)} de ${ingrediente.nome}` : 'item inválido';
            }).join(', ') || 'Sem ingredientes';
            const custoTotal = calculatePizzaCost(pizza.id);
            const row = tbody.insertRow();
            row.innerHTML = `<td data-label="Pizza">${pizza.nome} (${pizza.tamanho||''})</td><td data-label="Ingredientes"><small>${ingredientesList}</small></td><td data-label="Custo Total" class="admin-only">${formatCurrency(custoTotal)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="editReceita('${receita.pizzaId}')">Editar</button><button class="action-btn remove-btn" onclick="removeReceita('${receita.pizzaId}')">Remover</button></td>`;
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
        showLoader();
        const receitaData = {
            pizzaId,
            ingredientes: [...receitaAtualIngredientes]
        };

        const { error } = await supabaseClient.from('receitas').upsert(receitaData, { onConflict: 'pizzaId' });

        if (error) {
            alert('Erro ao salvar receita: ' + error.message);
        } else {
            showSaveStatus('Receita salva!');
            receitaAtualIngredientes = [];
            renderReceitaIngredientesList();
            document.getElementById('form-receita').reset();
            document.getElementById('receita-ingrediente-select').value = '';
            document.getElementById('receita-ingrediente-qtd').value = '';
            await loadDataFromSupabase();
        }
        hideLoader();
    });

    window.editReceita = pizzaId => {
        document.getElementById('receita-pizza-select').value = pizzaId;
        document.getElementById('receita-pizza-select').dispatchEvent(new Event('change'));
        document.querySelector('[data-tab="receitas"]').scrollIntoView();
    };

    window.removeReceita = async pizzaId => {
        if (confirm('Tem certeza que deseja remover esta receita?')) {
            showLoader();
            const { error } = await supabaseClient.from('receitas').delete().eq('pizzaId', pizzaId);
            if (error) {
                alert('Erro ao remover receita: ' + error.message);
            } else {
                await loadDataFromSupabase();
            }
            hideLoader();
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

        showLoader();
        const newPedidoData = {
            cliente,
            telefone: document.getElementById('pedido-cliente-telefone').value,
            vendedor,
            cidade,
            pagamento,
            data: new Date().toISOString(),
            status: 'Pendente',
            items: pedidoAtualItems.map(item => {
                if (item.isCustom) return { ...item, custo: 0, preco: 0 };
                const pizzaData = database.estoque.find(p => p.id === item.pizzaId);
                const custo = pizzaData ? calculatePizzaCost(pizzaData.id) : 0;
                const preco = pizzaData ? pizzaData.precoVenda : 0;
                return { ...item, custo, preco };
            })
        };
        newPedidoData.valorTotal = newPedidoData.items.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        newPedidoData.custoTotal = newPedidoData.items.reduce((acc, item) => acc + (item.custo * item.qtd), 0);
        newPedidoData.lucro = newPedidoData.valorTotal - newPedidoData.custoTotal;
        
        const { data: newOrder, error: insertError } = await supabaseClient.from('pedidos').insert(newPedidoData).select().single();

        if (insertError) {
            alert('Erro ao registrar pedido: ' + insertError.message);
            hideLoader();
            return;
        }

        const stockUpdates = [];
        for (const item of newPedidoData.items) {
            if (!item.isCustom) {
                const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                if (pizzaEstoque) {
                    const newQty = pizzaEstoque.qtd - item.qtd;
                    const newHistory = [...(pizzaEstoque.history || []), {type: 'sale', date: new Date().toISOString(), orderId: newOrder.id}];
                    stockUpdates.push(supabaseClient.from('estoque').update({ qtd: newQty, history: newHistory }).eq('id', item.pizzaId));
                }
            }
        }

        const results = await Promise.all(stockUpdates);
        const stockError = results.find(res => res.error);

        if (stockError) {
            alert('Pedido registrado, mas houve um erro ao atualizar o estoque: ' + stockError.error.message);
        } else {
            showSaveStatus('Pedido registrado com sucesso!');
        }

        pedidoAtualItems = [];
        document.getElementById('form-pedido-principal').reset();
        document.getElementById('pedido-itens-carrinho').innerHTML = '';
        await loadDataFromSupabase();
        hideLoader();
    };

    const salvarPedidoEditado = async (editId) => {
        showLoader();
        const pedidoIndex = database.pedidos.findIndex(p => p.id === editId);
        if (pedidoIndex === -1) { alert("Erro: Pedido não encontrado para edição."); hideLoader(); return; }

        const updatedPedido = {
            cliente: document.getElementById('pedido-cliente').value,
            telefone: document.getElementById('pedido-cliente-telefone').value,
            vendedor: document.getElementById('pedido-vendedor').value,
            cidade: document.getElementById('pedido-cidade').value,
            pagamento: document.getElementById('pedido-pagamento').value,
            items: pedidoAtualItems.map(item => {
                if (item.isCustom) return { ...item, custo: 0, preco: 0 };
                const pizzaData = database.estoque.find(p => p.id === item.pizzaId);
                const custo = pizzaData ? calculatePizzaCost(pizzaData.id) : 0;
                const preco = pizzaData ? pizzaData.precoVenda : 0;
                return { ...item, custo, preco };
            })
        };
        updatedPedido.valorTotal = updatedPedido.items.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        updatedPedido.custoTotal = updatedPedido.items.reduce((acc, item) => acc + (item.custo * item.qtd), 0);
        updatedPedido.lucro = updatedPedido.valorTotal - updatedPedido.custoTotal;
        
        const stockUpdates = [];

        for (const item of originalItemsParaEdicao) {
            if (!item.isCustom) {
                const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                if (pizzaEstoque) {
                    const newQty = pizzaEstoque.qtd + item.qtd;
                    const newHistory = [...(pizzaEstoque.history || []), {type: 'edit_return', date: new Date().toISOString(), orderId: editId}];
                    stockUpdates.push(supabaseClient.from('estoque').update({ qtd: newQty, history: newHistory }).eq('id', item.pizzaId));
                }
            }
        }
        await Promise.all(stockUpdates);
        
        const freshStockData = (await supabaseClient.from('estoque').select('*')).data;
        database.estoque = freshStockData;
        
        const newStockUpdates = [];
        for (const item of updatedPedido.items) {
            if (!item.isCustom) {
                const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                 if (pizzaEstoque) {
                    const newQty = pizzaEstoque.qtd - item.qtd;
                    const newHistory = [...(pizzaEstoque.history || []), {type: 'sale_after_edit', date: new Date().toISOString(), orderId: editId}];
                    newStockUpdates.push(supabaseClient.from('estoque').update({ qtd: newQty, history: newHistory }).eq('id', item.pizzaId));
                }
            }
        }
        await Promise.all(newStockUpdates);
        
        const { error: updateError } = await supabaseClient.from('pedidos').update(updatedPedido).eq('id', editId);
        if(updateError) {
             alert('Erro ao salvar alterações no pedido: ' + updateError.message);
        } else {
            showSaveStatus('Pedido atualizado com sucesso!');
        }

        cancelEditPedido();
        await loadDataFromSupabase();
        hideLoader();
    };

    window.editPedido = (id) => {
        const pedido = database.pedidos.find(p => p.id === id);
        if (!pedido || pedido.status !== 'Pendente') { alert('Apenas pedidos pendentes podem ser editados.'); return; }

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

        filteredData.forEach(p => {
            const row = tbody.insertRow();
            const itemsHtml = p.items.map(i => `<li class="${i.isCustom?'item-pedido-outro':''}">${i.qtd}x ${i.pizzaNome}</li>`).join('');
            let acoesHtml = `${p.status==='Pendente'?`<button class="action-btn edit-btn" onclick="editPedido('${p.id}')">Editar</button><button class="action-btn complete-btn" onclick="concluirPedido('${p.id}')">Concluir</button>`:''}<button class="action-btn remove-btn" onclick="removerPedido('${p.id}')">Remover</button>`;
            row.innerHTML = `<td data-label="Cliente">${p.cliente}</b><br><small>${p.telefone||"N/A"}</small></td><td data-label="Itens"><ul style="padding-left:15px;margin:0">${itemsHtml}</ul></td><td data-label="Detalhes"><small>Vend.: ${p.vendedor}<br>Cid.: ${p.cidade}<br>Pag.: ${p.pagamento}</small></td><td data-label="Valores"><b>Total: ${formatCurrency(p.valorTotal)}</b><br><small class="admin-only">Custo: ${formatCurrency(p.custoTotal)}</small><br><b class="admin-only" style="color:${p.lucro>=0?"green":"red"}">${p.lucro>=0?"+":""}${formatCurrency(p.lucro)}</b></td><td data-label="Status"><span class="status-${p.status.toLowerCase()}">${p.status}</span></td><td data-label="Ações">${acoesHtml}</td>`;
        });
    };

    window.concluirPedido = async id => {
        showLoader();
        const { error } = await supabaseClient.from('pedidos').update({ status: 'Concluído' }).eq('id', id);
        if (error) {
            alert('Erro ao concluir pedido: ' + error.message);
        } else {
            await loadDataFromSupabase();
        }
        hideLoader();
    };

    window.removerPedido = async id => {
        const pedidoParaRemover = database.pedidos.find(p => p.id === id);
        if (pedidoParaRemover && confirm(`Tem certeza que deseja remover o pedido de ${pedidoParaRemover.cliente}?`)) {
            showLoader();
            const { error } = await supabaseClient.rpc('remove_order', { order_id: id });
            if (error) {
                alert('Erro ao remover pedido: ' + error.message);
            }
            await loadDataFromSupabase();
            hideLoader();
        }
    };

    document.getElementById('search-pedidos').addEventListener('input', renderPedidos);

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
        Object.values(chartInstances).forEach(chart => { if (chart && typeof chart.destroy === 'function') chart.destroy() });
        const filteredPedidos = getFilteredPedidos(filterRange);
        renderBalancoChart(filteredPedidos);
        renderPizzasMaisLucrativasChart(filteredPedidos);
        renderVendasPorVendedorChart(filteredPedidos);
        renderPizzasMaisVendidasChart(filteredPedidos);
        renderVendasPorDiaChart(filteredPedidos);
    };

    const renderBalancoChart=(t)=>{const e=t.reduce((t,e)=>t+Number(e.valorTotal),0),a=t.reduce((t,e)=>t+Number(e.custoTotal),0),r=t.reduce((t,e)=>t+Number(e.lucro),0),o=document.getElementById("balancoChart").getContext("2d");chartInstances.balanco=new Chart(o,{type:"bar",data:{labels:["Balanço Financeiro"],datasets:[{label:"Receita Total",data:[e],backgroundColor:"#2ecc71",borderWidth:1},{label:"Custo Total",data:[a],backgroundColor:"#e74c3c",borderWidth:1},{label:"Lucro Total",data:[r],backgroundColor:"#3498db",borderWidth:1}]},options:{indexAxis:"y",responsive:!0,scales:{x:{ticks:{callback:t=>formatCurrency(t)}}}}})};
    const renderPizzasMaisLucrativasChart=(t)=>{const e=t.flatMap(t=>t.items).reduce((t,e)=>{if(e.isCustom)return t;const a=(e.preco-e.custo)*e.qtd;return t[e.pizzaNome]=(t[e.pizzaNome]||0)+a,t},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("pizzasMaisLucrativasChart").getContext("2d");chartInstances.lucro=new Chart(o,{type:"doughnut",data:{labels:a,datasets:[{data:r,backgroundColor:["#2ecc71","#3498db","#9b59b6","#f1c40f","#e67e22","#1abc9c"]}]},options:{responsive:!0,plugins:{legend:{position:"top"},tooltip:{callbacks:{label:t=>`${t.label}: ${formatCurrency(t.raw)}`}}}}})};
    const renderVendasPorVendedorChart=(t)=>{const e=t.reduce((t,e)=>{if(e.vendedor)t[e.vendedor]=(t[e.vendedor]||0)+Number(e.valorTotal);return t},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("vendasPorVendedorChart").getContext("2d");chartInstances.vendedor=new Chart(o,{type:"bar",data:{labels:a,datasets:[{label:"Total Vendido",data:r,backgroundColor:"#487eb0"}]},options:{responsive:!0,scales:{y:{ticks:{callback:t=>formatCurrency(t)}}}}})};
    const renderPizzasMaisVendidasChart=(t)=>{const e=t.flatMap(t=>t.items).reduce((t,e)=>{return e.isCustom?t:(t[e.pizzaNome]=(t[e.pizzaNome]||0)+e.qtd,t)},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("pizzasMaisVendidasChart").getContext("2d");chartInstances.vendas=new Chart(o,{type:"pie",data:{labels:a,datasets:[{data:r,backgroundColor:["#e74c3c","#3498db","#f1c40f","#2ecc71","#9b59b6","#1abc9c"]}]},options:{responsive:!0,plugins:{legend:{position:"top"}}}})};
    const renderVendasPorDiaChart=(t)=>{const e=t.reduce((t,e)=>{const a=new Date(e.data).toLocaleDateString("pt-BR");return t[a]=(t[a]||0)+Number(e.valorTotal),t},{}),a=Object.keys(e).sort((t,a)=>new Date(t.split("/").reverse().join("-"))-new Date(a.split("/").reverse().join("-"))),r=a.map(t=>e[t]),o=document.getElementById("vendasPorDiaChart").getContext("2d");chartInstances.dia=new Chart(o,{type:"line",data:{labels:a,datasets:[{label:"Receita por Dia",data:r,borderColor:"#2c3e50",tension:.1,fill:!1}]},options:{responsive:!0,scales:{y:{ticks:{callback:t=>formatCurrency(t)}}}}})};

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
    
    // Funções das novas funcionalidades
    const processCustomerData = () => {
        const customerMap = new Map();
        database.pedidos.forEach(pedido => {
            const key = `${pedido.cliente.toLowerCase()}|${pedido.cidade.toLowerCase()}`;
            if (!customerMap.has(key)) {
                customerMap.set(key, {
                    nome: pedido.cliente,
                    telefone: pedido.telefone,
                    cidade: pedido.cidade,
                    numPedidos: 0,
                    totalGasto: 0,
                    ultimoPedido: new Date(0)
                });
            }
            const customer = customerMap.get(key);
            customer.numPedidos++;
            customer.totalGasto += Number(pedido.valorTotal);
            const dataPedido = new Date(pedido.data);
            if(dataPedido > customer.ultimoPedido) {
                customer.ultimoPedido = dataPedido;
                customer.telefone = pedido.telefone;
            }
        });
        database.clientes = Array.from(customerMap.values());
        
        const datalist = document.getElementById('clientes-list');
        datalist.innerHTML = '';
        database.clientes.forEach(cliente => {
            datalist.innerHTML += `<option value="${cliente.nome}">`;
        });
    };
    
    const renderClientesReport = () => {
        const searchTerm = document.getElementById('search-clientes').value.toLowerCase();
        const tbody = document.getElementById('tabela-clientes').querySelector('tbody');
        tbody.innerHTML = '';

        const filteredData = database.clientes.filter(c => c.nome.toLowerCase().includes(searchTerm) || c.cidade.toLowerCase().includes(searchTerm));

        filteredData.sort((a,b) => b.totalGasto - a.totalGasto);

        filteredData.forEach(c => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td data-label="Nome do Cliente">${c.nome}</td>
                <td data-label="Telefone">${c.telefone || 'N/A'}</td>
                <td data-label="Cidade">${c.cidade}</td>
                <td data-label="Nº de Pedidos">${c.numPedidos}</td>
                <td data-label="Total Gasto">${formatCurrency(c.totalGasto)}</td>
                <td data-label="Último Pedido">${c.ultimoPedido.toLocaleDateString('pt-BR')}</td>
            `;
        });
    };

    document.getElementById('search-clientes').addEventListener('input', renderClientesReport);
    
    document.getElementById('pedido-cliente').addEventListener('input', (e) => {
        const nome = e.target.value;
        const cliente = database.clientes.find(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(cliente) {
            document.getElementById('pedido-cliente-telefone').value = cliente.telefone || '';
            document.getElementById('pedido-cidade').value = cliente.cidade || '';
        }
    });

    document.getElementById('btn-lista-compras').addEventListener('click', () => {
        const itemsBaixos = database.ingredientes.filter(i => i.qtd < i.estoqueMinimo);
        const container = document.getElementById('lista-compras-content');

        if(itemsBaixos.length === 0) {
            container.innerHTML = '<p>Ótima notícia! Nenhum ingrediente está com estoque baixo.</p>';
        } else {
            let tableHtml = `
                <table>
                    <thead>
                        <tr>
                            <th>Ingrediente</th>
                            <th>Estoque Atual</th>
                            <th>Estoque Mínimo</th>
                            <th>Comprar (sugestão)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            itemsBaixos.forEach(item => {
                const comprar = (item.estoqueMinimo - item.qtd).toFixed(3);
                tableHtml += `
                    <tr>
                        <td>${item.nome}</td>
                        <td>${item.qtd.toFixed(3)}</td>
                        <td>${item.estoqueMinimo.toFixed(3)}</td>
                        <td><b>${comprar}</b></td>
                    </tr>
                `;
            });
            tableHtml += '</tbody></table>';
            container.innerHTML = tableHtml;
        }
        document.getElementById('modal-lista-compras').style.display = 'block';
    });
    
    window.closeModal = (modalId) => {
        document.getElementById(modalId).style.display = 'none';
    };
    
    document.getElementById('btn-print-lista').addEventListener('click', () => {
        window.print();
    });
    
    document.getElementById('form-producao').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pizzaId = document.getElementById('producao-pizza-select').value;
        const quantidade = parseInt(document.getElementById('producao-qtd').value);

        if(!pizzaId || !quantidade || quantidade < 1) {
            alert('Por favor, selecione uma pizza e informe uma quantidade válida.');
            return;
        }
        
        if(!confirm(`Confirma a produção de ${quantidade}x ${database.estoque.find(p=>p.id === pizzaId).nome}? Isso dará baixa nos ingredientes.`)) {
            return;
        }

        showLoader();
        const { data, error } = await supabaseClient.rpc('realizar_producao', {
            p_pizza_id: pizzaId,
            p_quantidade: quantidade
        });

        if (error) {
            const friendlyMessage = error.message.replace(/ESTOQUE_INSUFICIENTE: |RECEITA_NAO_ENCONTRADA/g, match => {
                if (match === 'RECEITA_NAO_ENCONTRADA') return 'Receita não encontrada para esta pizza.';
                return 'Estoque insuficiente para: ';
            });
            alert(`Erro ao registrar produção: ${friendlyMessage}`);
        } else {
            showSaveStatus(data);
            await loadDataFromSupabase();
        }
        
        e.target.reset();
        hideLoader();
    });
    
    loadDataFromSupabase();
});