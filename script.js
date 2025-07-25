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
        clientes: [],
        massas: []
    };

    let sortState = {
        pedidos: { column: 'dataEntrega', direction: 'desc'},
        clientes: { column: 'nome', direction: 'asc' },
        estoque: { column: 'nome', direction: 'asc' },
        ingredientes: { column: 'nome', direction: 'asc' },
        demanda: { column: 'quantidade', direction: 'desc' },
    };

    let pedidoAtualItems = [];
    let pedidoEditItems = [];
    let receitaAtualIngredientes = [];
    let saveStatusTimeout;
    const chartInstances = {};
    let currentDateForCalendar = new Date();

    const showLoader = () => LOADER.style.display = 'flex';
    const hideLoader = () => LOADER.style.display = 'none';

    const showSaveStatus = (message, isSuccess = true) => {
        clearTimeout(saveStatusTimeout);
        SAVE_STATUS.textContent = message;
        SAVE_STATUS.className = `visible ${isSuccess ? 'success' : 'error'}`;
        saveStatusTimeout = setTimeout(() => {
            SAVE_STATUS.className = '';
        }, 4000);
    };

    const formatCurrency = (value) => {
        if (isNaN(value) || value === null) value = 0;
        return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
    };
    
    const formatDateToYYYYMMDD = (date) => {
        const d = new Date(date);
        const userTimezoneOffset = d.getTimezoneOffset() * 60000;
        const adjustedDate = new Date(d.getTime() + userTimezoneOffset);
        const year = adjustedDate.getFullYear();
        const month = String(adjustedDate.getMonth() + 1).padStart(2, '0');
        const day = String(adjustedDate.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const calculatePizzaCost = (pizzaId, ingredientsSource = database.ingredientes) => {
        const receita = database.receitas.find(r => r.pizzaId === pizzaId);
        if (!receita || !receita.ingredientes) return 0;
        return receita.ingredientes.reduce((total, itemReceita) => {
            const ingrediente = ingredientsSource.find(i => i.id === itemReceita.ingredienteId);
            return total + (ingrediente ? ingrediente.custo * itemReceita.qtd : 0);
        }, 0);
    };

    const loadDataFromSupabase = async () => {
        showLoader();
        try {
            const results = await Promise.all([
                supabaseClient.from('ingredientes').select('*').order('nome'),
                supabaseClient.from('estoque').select('*').order('nome'),
                supabaseClient.from('receitas').select('*'),
                supabaseClient.from('pedidos').select('*').order('created_at', { ascending: false }),
                supabaseClient.from('clientes').select('*').order('nome'),
                supabaseClient.from('massas').select('*')
            ]);
            
            const errors = results.map(r => r.error).filter(Boolean);
            if (errors.length > 0) {
                throw new Error(errors.map(e => e.message).join('\n'));
            }

            database.ingredientes = results[0].data || [];
            database.estoque = results[1].data || [];
            database.receitas = results[2].data || [];
            database.pedidos = results[3].data || [];
            database.clientes = results[4].data || [];
            database.massas = results[5].data || [];
            
            await syncClientsFromOrders();
            renderAll();
        } catch (error) {
            console.error("Erro ao carregar dados do Supabase:", error);
            showSaveStatus("Falha ao carregar dados. Verifique o console.", false);
        } finally {
            hideLoader();
        }
    };
    
    // ====================================================================
    // FUNÇÃO CORRIGIDA
    // ====================================================================
    const syncClientsFromOrders = async () => {
        const existingClientKeys = new Set(database.clientes.map(c => `${c.nome.toLowerCase()}|${c.cidade.toLowerCase()}`));
        const newClientsMap = new Map();

        database.pedidos.forEach(pedido => {
            if (pedido.cliente && pedido.cidade) {
                const clientKey = `${pedido.cliente.toLowerCase()}|${pedido.cidade.toLowerCase()}`;
                if (!existingClientKeys.has(clientKey) && !newClientsMap.has(clientKey)) {
                    // CORREÇÃO: Adiciona valores padrão para as novas colunas obrigatórias.
                    newClientsMap.set(clientKey, {
                        nome: pedido.cliente,
                        cidade: pedido.cidade,
                        telefone: pedido.telefone || null,
                        // Adiciona um e-mail falso para garantir que o campo não seja nulo, se necessário.
                        email: `antigo-${pedido.cliente.replace(/\s+/g, '').toLowerCase()}@sasses.pizza`,
                        // Define o status como 'aprovado' para clientes antigos.
                        status_cadastro: 'aprovado' 
                    });
                }
            }
        });

        const clientsToUpsert = Array.from(newClientsMap.values());

        if (clientsToUpsert.length > 0) {
            console.log(`Sincronizando ${clientsToUpsert.length} novo(s) cliente(s) a partir de pedidos antigos...`);
            const { data, error } = await supabaseClient.from('clientes').upsert(clientsToUpsert, { onConflict: 'nome,cidade' }).select();
            
            if (error) {
                console.error('Erro ao sincronizar clientes:', error);
                showSaveStatus('Erro ao sincronizar clientes antigos.', false);
            }
            if (data) {
                // Adiciona os novos clientes sincronizados à base de dados local
                database.clientes = [...database.clientes, ...data];
            }
        }
    };

    const renderAll = () => {
        populateSelects();
        populateWeekSelector();
        renderIngredientes();
        renderEstoque();
        renderReceitas();
        renderPedidos();
        renderClientes();
        renderProductionDemand();
        renderCalendar(currentDateForCalendar.getFullYear(), currentDateForCalendar.getMonth());
        populateClienteDatalist();
        populateFilterDropdowns();
        renderDashboard(document.querySelector('.date-filter.active')?.dataset.range || 'all');
        renderEstoqueResumido();
    };

    const populateSelects = (selectElementId) => {
        const pizzaEstoqueSelect = document.getElementById(selectElementId || 'item-pizza');
        const firstOption = pizzaEstoqueSelect.options[0];
        pizzaEstoqueSelect.innerHTML = '';
        if (firstOption) pizzaEstoqueSelect.appendChild(firstOption);

        database.estoque.forEach(p => {
            const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
            const stockStyle = (p.qtd <= 0) ? 'color:red;' : '';
            pizzaEstoqueSelect.innerHTML += `<option value="${p.id}" style="${stockStyle}">${label} (Estoque: ${p.qtd})</option>`;
        });
        pizzaEstoqueSelect.innerHTML += '<option value="outro">Outro...</option>';

        if (!selectElementId) {
            ['producao-pizza-select', 'receita-pizza-select'].forEach(id => {
                const sel = document.getElementById(id);
                const firstOpt = sel.options[0];
                sel.innerHTML = '';
                if(firstOpt) sel.appendChild(firstOpt);
                database.estoque.forEach(p => {
                    const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
                     sel.innerHTML += `<option value="${p.id}">${label}</option>`;
                });
            });
            const ingredienteReceitaSelect = document.getElementById('receita-ingrediente-select');
            
            const firstOpt = ingredienteReceitaSelect.options[0];
            ingredienteReceitaSelect.innerHTML = '';
            if(firstOpt) ingredienteReceitaSelect.appendChild(firstOpt);
            database.ingredientes.forEach(i => {
                ingredienteReceitaSelect.innerHTML += `<option value="${i.id}">${i.nome}</option>`;
            });
        }
    };

    const populateWeekSelector = (selectElement) => {
        const weekSelect = selectElement || document.getElementById('pedido-semana-entrega');
        const firstOption = weekSelect.options[0];
        weekSelect.innerHTML = '';
        if (firstOption) weekSelect.appendChild(firstOption);

        let today = new Date();
        for (let i = 0; i < 12; i++) {
            let startOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + 1));
            let endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(endOfWeek.getDate() + 6);

            const startFormatted = startOfWeek.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
            const endFormatted = endOfWeek.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
            const weekValue = formatDateToYYYYMMDD(startOfWeek);

            weekSelect.innerHTML += `<option value="${weekValue}">Semana de ${startFormatted} a ${endFormatted}</option>`;
            today.setDate(today.getDate() + 7);
        }
    };

    const populateClienteDatalist = () => {
        const datalist = document.getElementById('clientes-list');
        datalist.innerHTML = '';
        database.clientes.forEach(cliente => {
            datalist.innerHTML += `<option value="${cliente.nome}">`;
        });
    };

    const populateFilterDropdowns = () => {
        const vendedorSelect = document.getElementById('filter-vendedor');
        const vendedores = [...new Set(database.pedidos.map(p => p.vendedor).filter(Boolean))];
        
        const firstOption = vendedorSelect.options[0];
        vendedorSelect.innerHTML = '';
        if (firstOption) vendedorSelect.appendChild(firstOption);
        vendedores.sort().forEach(v => {
            vendedorSelect.innerHTML += `<option value="${v}">${v}</option>`;
        });
    };

    document.querySelectorAll('.tab-link').forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.dataset.tab;
            document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            if (tabId === 'graficos') {
                renderDashboard(document.querySelector('.date-filter.active')?.dataset.range || 'all');
            }
        });
    });

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

    window.openModal = (modalId, title, contentHTML, callback) => {
        const modal = document.getElementById(modalId);
        const modalTitle = document.getElementById(`${modalId}-title`);
        const contentContainer = document.getElementById(`${modalId}-content`);
    
        if (modalTitle) modalTitle.textContent = title;
        if (contentContainer) contentContainer.innerHTML = contentHTML;
        
        if (callback) {
            callback();
        }
        modal.style.display = 'block';
    };

    window.closeModal = (modalId) => {
        document.getElementById(modalId).style.display = 'none';
        const contentContainer = document.getElementById(`${modalId}-content`);
        if (contentContainer) contentContainer.innerHTML = '';
    };

    const renderClientes = () => {
        const searchTerm = document.getElementById('search-clientes').value.toLowerCase();
        let filteredData = database.clientes.filter(c => 
            (c.nome || '').toLowerCase().includes(searchTerm) || 
            (c.cidade || '').toLowerCase().includes(searchTerm) ||
            (c.telefone || '').toLowerCase().includes(searchTerm)
        );

        const { column, direction } = sortState.clientes;
        filteredData.sort((a, b) => {
            const valA = a[column] ?? '';
            const valB = b[column] ?? '';
            if (typeof valA === 'number') return valA - valB;
            return (valA || '').localeCompare(valB || '');
        });
        if (direction === 'desc') filteredData.reverse();

        const tbody = document.getElementById('tabela-clientes').querySelector('tbody');
        tbody.innerHTML = '';
        filteredData.forEach(c => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td data-label="Nome do Cliente">${c.nome}</td>
                <td data-label="Telefone">${c.telefone || 'N/A'}</td>
                <td data-label="Cidade">${c.cidade || 'N/A'}</td>
                <td data-label="Ações">
                    <button class="action-btn history-btn" onclick="openHistoryModal('${c.id}')">Histórico</button>
                    <button class="action-btn edit-btn" onclick="openEditClientModal('${c.id}')">Editar</button>
                </td>
            `;
        });
        updateSortHeaders('tabela-clientes', column, direction);
    };

    window.openEditClientModal = (id) => {
        const cliente = database.clientes.find(c => c.id === id);
        if (!cliente) return;
        const formHTML = `
            <form id="edit-client-form">
                <input type="hidden" name="id" value="${cliente.id}">
                <div class="form-group">
                    <label for="edit-cliente-nome">Nome</label>
                    <input type="text" id="edit-cliente-nome" name="nome" value="${cliente.nome || ''}" required>
                </div>
                <div class="form-group">
                    <label for="edit-cliente-telefone">Telefone</label>
                    <input type="text" id="edit-cliente-telefone" name="telefone" value="${cliente.telefone || ''}">
                </div>
                <div class="form-group">
                    <label for="edit-cliente-cidade">Cidade</label>
                    <input type="text" id="edit-cliente-cidade" name="cidade" value="${cliente.cidade || ''}" required>
                </div>
                <button type="submit">Salvar Alterações</button>
            </form>
        `;
        openModal('edit-modal', 'Editar Cliente', formHTML, () => {
            document.getElementById('edit-client-form').onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const updatedData = Object.fromEntries(formData.entries());
                showLoader();
                const { error } = await supabaseClient.from('clientes').update({
                    nome: updatedData.nome,
                    telefone: updatedData.telefone,
                    cidade: updatedData.cidade
                }).eq('id', updatedData.id);
                hideLoader();
                if (error) {
                    showSaveStatus('Erro ao atualizar cliente: ' + error.message, false);
                } else {
                    showSaveStatus('Cliente atualizado com sucesso!');
                    await loadDataFromSupabase();
                    closeModal('edit-modal');
                }
            };
        });
    };
    
    window.openHistoryModal = (clientId) => {
        const cliente = database.clientes.find(c => c.id === clientId);
        if (!cliente) return;

        const pedidosCliente = database.pedidos.filter(p => p.clienteId === clientId).sort((a,b) => new Date(b.dataEntrega) - new Date(a.dataEntrega));
        
        let tableHTML = '<p>Nenhum pedido encontrado para este cliente.</p>';
        if (pedidosCliente.length > 0) {
            tableHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Semana</th>
                            <th>Itens</th>
                            <th>Valor</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            pedidosCliente.forEach(p => {
                const itemsHtml = p.items.map(i => `<li>${i.qtd}x ${i.pizzaNome}</li>`).join('');
                const startOfWeek = new Date(p.dataEntrega);
                const weekStartFormatted = startOfWeek.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
                const valorExibido = p.valorFinal || p.valorTotal;
                tableHTML += `
                    <tr>
                        <td>${weekStartFormatted}</td>
                        <td><ul>${itemsHtml}</ul></td>
                        <td>${formatCurrency(valorExibido)}</td>
                        <td><span class="status-${(p.status || 'pendente').toLowerCase()}">${p.status}</span></td>
                    </tr>
                `;
            });
            tableHTML += '</tbody></table>';
        }
        openModal('history-modal', `Histórico de ${cliente.nome}`, tableHTML);
    };

    document.getElementById('search-clientes').addEventListener('input', renderClientes);

    const renderPedidos = () => {
        const searchTerm = document.getElementById('search-pedidos').value.toLowerCase();
        const vendedorFilter = document.getElementById('filter-vendedor').value;
        const statusFilter = document.getElementById('filter-status').value;

        let filteredData = database.pedidos.filter(p => {
            const searchMatch = (p.cliente || '').toLowerCase().includes(searchTerm);
            const vendedorMatch = !vendedorFilter || p.vendedor === vendedorFilter;
            const statusMatch = !statusFilter || p.status === statusFilter;
            return searchMatch && vendedorMatch && statusMatch;
        });
        
        const { column, direction } = sortState.pedidos;
        filteredData.sort((a, b) => {
            const valA = a[column] ?? '';
            const valB = b[column] ?? '';
            if (column === 'dataEntrega') return new Date(valA) - new Date(valB);
            if (typeof valA === 'number') return valA - valB;
            return (valA || '').localeCompare(valB || '');
        });
        if (direction === 'desc') filteredData.reverse();

        const tbody = document.getElementById('tabela-pedidos').querySelector('tbody');
        tbody.innerHTML = '';
        filteredData.forEach(p => {
            const row = tbody.insertRow();
            const itemsHtml = p.items.map(i => `<li class="${i.isCustom?'item-pedido-outro':''}">${i.qtd}x ${i.pizzaNome}</li>`).join('');
            const statusClass = (p.status || 'pendente').toLowerCase().replace(/ /g, '-');
            const startOfWeek = new Date(p.dataEntrega);
            const weekStartFormatted = startOfWeek.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
            const valorExibido = p.valorFinal || p.valorTotal;

            row.innerHTML = `
                <td data-label="Cliente">${p.cliente}</b><br><small>${p.telefone||"N/A"}</small></td>
                <td data-label="Semana Entrega">${weekStartFormatted}</td>
                <td data-label="Itens"><ul style="padding-left:15px;margin:0">${itemsHtml}</ul></td>
                <td data-label="Detalhes"><small>Vend.: ${p.vendedor}<br>Cid.: ${p.cidade}<br>Pag.: ${p.pagamento}</small></td>
                <td data-label="Valores"><b>${formatCurrency(valorExibido)}</b><br><small class="admin-only">Calc: ${formatCurrency(p.valorTotal)}</small></td>
                <td data-label="Status"><span class="status-${statusClass}">${p.status}</span></td>
                <td data-label="Ações">${renderActionButtons(p)}</td>
            `;
        });
        updateSortHeaders('tabela-pedidos', column, direction);
    };

    const renderActionButtons = (pedido) => {
        const removerBtn = `<button class="action-btn remove-btn" onclick="window.removerPedido('${pedido.id}')">Remover</button>`;
        const editarBtn = `<button class="action-btn edit-btn" onclick="window.openEditPedidoModal('${pedido.id}')">Editar</button>`;
        switch(pedido.status) {
            case 'Pendente':
                return `${editarBtn}<button class="action-btn" style="background-color:var(--accent-color)" onclick="window.updatePedidoStatus('${pedido.id}', 'Pronto')">Marcar Pronto</button>${removerBtn}`;
            case 'Pronto':
                return `${editarBtn}<button class="action-btn complete-btn" onclick="window.updatePedidoStatus('${pedido.id}', 'Concluído')">Marcar Concluído</button>${removerBtn}`;
            case 'Concluído':
                return `${editarBtn}${removerBtn}`;
            default:
                return removerBtn;
        }
    };

    window.updatePedidoStatus = async (id, newStatus) => {
        if (!confirm(`Tem certeza que deseja alterar o status para "${newStatus}"?`)) return;
        showLoader();

        try {
            if (newStatus === 'Pronto') {
                const pedido = database.pedidos.find(p => p.id === id);
                if (pedido) {
                    const stockUpdates = [];
                    for (const item of pedido.items) {
                        if (!item.isCustom) {
                            const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                            if(pizzaEstoque) {
                                stockUpdates.push({ id: item.pizzaId, newQty: pizzaEstoque.qtd - item.qtd });
                            }
                        }
                    }
                     await Promise.all(stockUpdates.map(upd => 
                        supabaseClient.from('estoque').update({ qtd: upd.newQty }).eq('id', upd.id)
                    ));
                }
            }

            const { error: statusError } = await supabaseClient.from('pedidos').update({ status: newStatus }).eq('id', id);
            if (statusError) throw statusError;

            showSaveStatus('Status do pedido atualizado!');
            await loadDataFromSupabase();

        } catch (error) {
             showSaveStatus(`Erro ao atualizar status: ${error.message}`, false);
        } finally {
            hideLoader();
        }
    };

    document.getElementById('btn-add-item-pedido').addEventListener('click', () => {
        const pizzaSelect = document.getElementById('item-pizza');
        const pizzaId = pizzaSelect.value;
        const qtd = parseInt(document.getElementById('item-qtd').value);
        if (!pizzaId || !qtd || qtd < 1) {
            alert('Selecione uma pizza e informe uma quantidade válida.');
            return;
        }

        let pizzaNome, isCustom = false, preco = 0;
        if (pizzaId === 'outro') {
            pizzaNome = document.getElementById('item-pizza-outro-nome').value.trim();
            if (!pizzaNome) { alert('Por favor, informe o nome da pizza.'); return; }
            const tamanho = document.getElementById('item-pizza-outro-tamanho').value;
            pizzaNome = `${pizzaNome} (${tamanho})`;
            isCustom = true;
        } else {
            const pizzaData = database.estoque.find(p => p.id === pizzaId);
            pizzaNome = pizzaData.tamanho ? `${pizzaData.nome} (${pizzaData.tamanho})` : pizzaData.nome;
            preco = pizzaData.precoVenda;
        }
        pedidoAtualItems.push({ pizzaId, pizzaNome, qtd, isCustom, preco });
        renderPedidoCarrinho();
        updateTotalPedido();
        pizzaSelect.value = '';
        document.getElementById('item-qtd').value = '1';
        document.getElementById('item-pizza-outro-nome').value = '';
        document.getElementById('item-pizza-outro-nome').classList.add('hidden');
        document.getElementById('item-pizza-outro-tamanho').classList.add('hidden');
    });

    const renderPedidoCarrinho = () => {
        const container = document.getElementById('pedido-itens-carrinho');
        container.innerHTML = '';
        if (pedidoAtualItems.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#777">Nenhuma pizza adicionada.</p>';
            return;
        }
        pedidoAtualItems.forEach((item, index) => {
            container.innerHTML += `<div class="carrinho-item"><p><span>${item.qtd}x</span> ${item.pizzaNome} ${item.isCustom?'<b class="item-pedido-outro">(Outro)</b>':""}</p><button type="button" class="btn-remove-item" onclick="window.removeItemPedido(${index})">X</button></div>`;
        });
    };

    window.removeItemPedido = index => {
        pedidoAtualItems.splice(index, 1);
        renderPedidoCarrinho();
        updateTotalPedido();
    };

    const updateTotalPedido = () => {
        const total = pedidoAtualItems.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        document.getElementById('total-calculado-pedido').textContent = formatCurrency(total);
        document.getElementById('valor-final-pedido').value = total.toFixed(2);
    };

    document.getElementById('btn-registrar-pedido').addEventListener('click', async () => {
        await registrarNovoPedido();
    });

    const registrarNovoPedido = async () => {
        if (pedidoAtualItems.length === 0) { alert('Adicione pelo menos uma pizza ao pedido.'); return; }
        const clienteNome = document.getElementById('pedido-cliente').value;
        const vendedor = document.getElementById('pedido-vendedor').value;
        const cidade = document.getElementById('pedido-cidade').value;
        const pagamento = document.getElementById('pedido-pagamento').value;
        const dataEntrega = document.getElementById('pedido-semana-entrega').value;
        if (!clienteNome || !pagamento || !vendedor || !cidade || !dataEntrega) { alert('Preencha todos os campos do pedido, incluindo a semana de entrega.'); return; }

        showLoader();

        let cliente = database.clientes.find(c => c.nome.toLowerCase() === clienteNome.toLowerCase() && c.cidade.toLowerCase() === cidade.toLowerCase());
        let clienteId;

        if (cliente) {
            clienteId = cliente.id;
        } else {
            const { data, error } = await supabaseClient.from('clientes')
                .insert({ 
                    nome: clienteNome, 
                    telefone: document.getElementById('pedido-cliente-telefone').value, 
                    cidade: cidade 
                }).select().single();
            if (error) {
                showSaveStatus(`Erro ao criar novo cliente: ${error.message}`, false);
                hideLoader();
                return;
            }
            clienteId = data.id;
        }
        
        const valorCalculado = pedidoAtualItems.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        const valorFinalInput = document.getElementById('valor-final-pedido').value;
        const valorFinal = parseFloat(valorFinalInput) || valorCalculado;

        const newPedidoData = {
            cliente: clienteNome,
            clienteId: clienteId,
            telefone: document.getElementById('pedido-cliente-telefone').value,
            vendedor,
            cidade,
            pagamento,
            dataEntrega,
            status: 'Pendente',
            items: pedidoAtualItems,
            valorTotal: valorCalculado,
            valorFinal: valorFinal
        };

        const { error: insertError } = await supabaseClient.from('pedidos').insert(newPedidoData).select().single();

        if (insertError) {
            showSaveStatus('Erro ao registrar pedido: ' + insertError.message, false);
        } else {
            showSaveStatus('Pedido registrado com sucesso!');
            resetFormPedido();
            await loadDataFromSupabase();
        }
        
        hideLoader();
    };
    
    const resetFormPedido = () => {
        document.getElementById('form-pedido-principal').reset();
        document.getElementById('pedido-edit-id').value = '';
        document.getElementById('valor-final-pedido').value = '';
        pedidoAtualItems = [];
        renderPedidoCarrinho();
        updateTotalPedido();
    };

    window.removerPedido = async (id) => {
        const pedido = database.pedidos.find(p => p.id === id);
        if (!pedido) return;

        if (confirm(`Tem certeza que deseja remover o pedido de ${pedido.cliente}? \nATENÇÃO: Itens em estoque serão retornados se o pedido já estava "Pronto" ou "Concluído".`)) {
            showLoader();
            
            const stockUpdates = [];
            if (pedido.status === 'Pronto' || pedido.status === 'Concluído') {
                for (const item of pedido.items) {
                    if (!item.isCustom) {
                        const pizzaEstoque = database.estoque.find(p => p.id === item.pizzaId);
                        if (pizzaEstoque) {
                            stockUpdates.push({ id: item.pizzaId, newQty: pizzaEstoque.qtd + item.qtd });
                        }
                    }
                }
            }
            
            try {
                const { error: deleteError } = await supabaseClient.from('pedidos').delete().eq('id', id);
                if (deleteError) throw deleteError;

                if(stockUpdates.length > 0) {
                    await Promise.all(stockUpdates.map(upd => 
                        supabaseClient.from('estoque').update({ qtd: upd.newQty }).eq('id', upd.id)
                    ));
                }

                showSaveStatus('Pedido removido e estoque reconciliado.');
                await loadDataFromSupabase();

            } catch (error) {
                showSaveStatus(`Erro ao remover pedido: ${error.message}`, false);
            } finally {
                hideLoader();
            }
        }
    };
    
    const renderCalendar = (year, month) => {
        const container = document.getElementById('calendario-container');
        const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        let html = `
            <div class="calendar-header">
                <button id="prev-month">&lt;</button>
                <h3>${monthNames[month]} ${year}</h3>
                <button id="next-month">&gt;</button>
            </div>
            <div class="calendar-grid">
                <div class="calendar-day-name">D</div><div class="calendar-day-name">S</div><div class="calendar-day-name">T</div><div class="calendar-day-name">Q</div><div class="calendar-day-name">Q</div><div class="calendar-day-name">S</div><div class="calendar-day-name">S</div>
        `;

        for (let i = 0; i < firstDay.getDay(); i++) {
            html += `<div class="calendar-day other-month"></div>`;
        }

        for (let i = 1; i <= lastDay.getDate(); i++) {
            const currentDate = new Date(year, month, i);
            const dateString = formatDateToYYYYMMDD(currentDate);
            const massaInfo = database.massas.find(m => m.dia === dateString);
            const doughCount = massaInfo ? massaInfo.quantidade : 0;
            let countClass = doughCount > 0 ? 'positive' : 'zero';

            html += `
                <div class="calendar-day" data-date="${dateString}">
                    <div class="day-number">${i}</div>
                    <div class="dough-count ${countClass}">${doughCount}</div>
                </div>
            `;
        }
        html += `</div>`;
        container.innerHTML = html;
        addCalendarEventListeners();
    };

    const addCalendarEventListeners = () => {
        document.getElementById('prev-month').addEventListener('click', () => {
            currentDateForCalendar.setMonth(currentDateForCalendar.getMonth() - 1);
            renderCalendar(currentDateForCalendar.getFullYear(), currentDateForCalendar.getMonth());
        });
        document.getElementById('next-month').addEventListener('click', () => {
            currentDateForCalendar.setMonth(currentDateForCalendar.getMonth() + 1);
            renderCalendar(currentDateForCalendar.getFullYear(), currentDateForCalendar.getMonth());
        });
        document.querySelectorAll('.calendar-day:not(.other-month)').forEach(day => {
            day.addEventListener('click', async (e) => {
                const date = e.currentTarget.dataset.date;
                const currentQty = database.massas.find(m => m.dia === date)?.quantidade || 0;
                const newQty = prompt(`Quantidade de massas para ${new Date(date + 'T12:00:00').toLocaleDateString('pt-BR')}:\n(Atual: ${currentQty})`, currentQty);

                if (newQty !== null && !isNaN(newQty) && newQty >= 0) {
                    showLoader();
                    const { error } = await supabaseClient.from('massas').upsert({ dia: date, quantidade: parseInt(newQty) }, { onConflict: 'dia' });
                    hideLoader();
                    if (error) {
                        showSaveStatus(`Erro ao salvar massas: ${error.message}`, false);
                    } else {
                        showSaveStatus('Quantidade de massas atualizada!');
                        await loadDataFromSupabase();
                    }
                }
            });
        });
    };
    
    const renderProductionDemand = () => {
        const tbody = document.getElementById('tabela-demanda-producao').querySelector('tbody');
        const sizeFilter = document.getElementById('filter-demanda-tamanho').value;
        const demandMap = new Map();

        database.pedidos
            .filter(p => p.status === 'Pendente')
            .forEach(p => {
                p.items.forEach(item => {
                    if (!item.isCustom) {
                        const pizzaEstoque = database.estoque.find(e => e.id === item.pizzaId);
                        if(pizzaEstoque) {
                            if (sizeFilter && pizzaEstoque.tamanho !== sizeFilter) {
                                return;
                            }
                            const key = pizzaEstoque.id;
                            const existing = demandMap.get(key) || { 
                                sabor: `${pizzaEstoque.nome} (${pizzaEstoque.tamanho})`, 
                                quantidade: 0, 
                                estoqueAtual: pizzaEstoque.qtd 
                            };
                            existing.quantidade += item.qtd;
                            demandMap.set(key, existing);
                        }
                    }
                });
            });

        let demandArray = Array.from(demandMap.values());
        
        const { column, direction } = sortState.demanda;
        demandArray.sort((a,b) => {
             const valA = a[column];
             const valB = b[column];
             if (column === 'saldo') {
                 const saldoA = a.estoqueAtual - a.quantidade;
                 const saldoB = b.estoqueAtual - b.quantidade;
                 return saldoA - saldoB;
             }
             if (typeof valA === 'number') return valA - valB;
             return (valA || '').localeCompare(valB || '');
        });

        if(direction === 'desc') demandArray.reverse();

        tbody.innerHTML = '';
        if(demandArray.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Nenhuma demanda de produção no momento.</td></tr>';
            return;
        }

        demandArray.forEach(({ sabor, quantidade, estoqueAtual }) => {
            const row = tbody.insertRow();
            const saldo = estoqueAtual - quantidade;
            
            let saldoDisplay;
            if (saldo < 0) {
                saldoDisplay = `<b style="color:var(--danger-color);">Faltam ${-saldo}</b>`;
            } else {
                saldoDisplay = saldo;
            }

            row.innerHTML = `
                <td data-label="Sabor da Pizza">${sabor}</td>
                <td data-label="Quantidade a Produzir">${quantidade}x</td>
                <td data-label="Estoque Atual">${estoqueAtual}</td>
                <td data-label="Saldo Final">${saldoDisplay}</td>
            `;
        });
        updateSortHeaders('tabela-demanda-producao', column, direction);
    };

    const renderEstoqueResumido = () => {
        const tbody = document.getElementById('tabela-estoque-resumido')?.querySelector('tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        const pizzasEmEstoque = database.estoque.filter(p => p.qtd > 0);

        if (pizzasEmEstoque.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">Nenhuma pizza em estoque.</td></tr>';
            return;
        }

        pizzasEmEstoque.forEach(p => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td data-label="Sabor">${p.nome}</td>
                <td data-label="Tamanho">${p.tamanho}</td>
                <td data-label="Qtd. em Estoque">${p.qtd}</td>
            `;
        });
    };


    document.getElementById('pedido-cliente').addEventListener('input', (e) => {
        const nome = e.target.value;
        const cliente = database.clientes.find(c => c.nome.toLowerCase() === nome.toLowerCase());
        if(cliente) {
            document.getElementById('pedido-cliente-telefone').value = cliente.telefone || '';
            document.getElementById('pedido-cidade').value = cliente.cidade || '';
        }
    });

    ['search-pedidos', 'filter-vendedor', 'filter-status'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderPedidos);
    });
    
    document.getElementById('filter-demanda-tamanho').addEventListener('input', renderProductionDemand);

    const handleSort = (tableKey, column) => {
        const state = sortState[tableKey];
        if (state.column === column) {
            state.direction = state.direction === 'asc' ? 'desc' : 'asc';
        } else {
            state.column = column;
            state.direction = 'asc';
        }
        
        const renderFunction = {
            pedidos: renderPedidos,
            clientes: renderClientes,
            estoque: renderEstoque,
            ingredientes: renderIngredientes,
            demanda: renderProductionDemand,
        }[tableKey];

        if (renderFunction) renderFunction();
    };
    
    const updateSortHeaders = (tableId, column, direction) => {
        const table = document.getElementById(tableId);
        if(!table) return;

        table.querySelectorAll('thead th[data-sort-by]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sortBy === column) {
                th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    };
    
    ['tabela-estoque', 'tabela-ingredientes', 'tabela-clientes', 'tabela-pedidos', 'tabela-demanda-producao'].forEach(id => {
        const table = document.getElementById(id);
        if(table) {
            table.querySelector('thead').addEventListener('click', e => {
                const header = e.target.closest('th');
                if (header && header.dataset.sortBy) {
                    const tableKey = id.replace('tabela-', '').replace('-producao', '');
                    handleSort(tableKey, header.dataset.sortBy);
                }
            });
        }
    });

    const renderIngredientes = () => {
        const searchTerm = document.getElementById('search-ingredientes').value.toLowerCase();
        let filteredData = database.ingredientes.filter(item => (item.nome || '').toLowerCase().includes(searchTerm));

        const { column, direction } = sortState.ingredientes;
        filteredData.sort((a, b) => {
            const valA = a[column] ?? '';
            const valB = b[column] ?? '';
            if (typeof valA === 'number') return valA - valB;
            return valA.localeCompare(valB);
        });
        if (direction === 'desc') filteredData.reverse();

        const tbody = document.getElementById('tabela-ingredientes').querySelector('tbody');
        tbody.innerHTML = '';
        filteredData.forEach(item => {
            const row = tbody.insertRow();
            if (item.qtd < item.estoqueMinimo) row.classList.add('low-stock');
            row.innerHTML = `<td data-label="Nome">${item.nome}</td><td data-label="Qtd. em Estoque">${(item.qtd || 0).toFixed(3)}</td><td data-label="Estoque Mínimo">${(item.estoqueMinimo || 0).toFixed(3)}</td><td data-label="Custo (p/ Unidade)" class="admin-only">${formatCurrency(item.custo)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editIngrediente('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="window.removeIngrediente('${item.id}')">Remover</button></td>`;
        });
        updateSortHeaders('tabela-ingredientes', column, direction);
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
        hideLoader();
        if (error) {
            showSaveStatus('Erro ao salvar ingrediente: ' + error.message, false);
        } else {
            showSaveStatus('Ingrediente salvo!');
            e.target.reset();
            document.getElementById('ingrediente-id').value = '';
            await loadDataFromSupabase();
        }
    });

    window.editIngrediente = (id) => {
        const item = database.ingredientes.find(i => i.id === id);
        if (!item) return;

        const formHTML = `
            <form id="edit-ingrediente-form">
                <div class="form-group"><label>Nome</label><input type="text" name="nome" value="${item.nome}" required></div>
                <div class="form-group"><label>Quantidade</label><input type="number" name="qtd" value="${item.qtd}" step="0.001" required></div>
                <div class="form-group"><label>Custo</label><input type="number" name="custo" value="${item.custo}" step="0.01" required></div>
                <div class="form-group"><label>Estoque Mínimo</label><input type="number" name="estoqueMinimo" value="${item.estoqueMinimo}" step="0.001" required></div>
                <button type="submit">Salvar</button>
            </form>
        `;

        openModal('edit-modal', 'Editar Ingrediente', formHTML, () => {
             document.getElementById('edit-ingrediente-form').onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const updatedData = {
                    nome: formData.get('nome'),
                    qtd: parseFloat(formData.get('qtd')),
                    custo: parseFloat(formData.get('custo')),
                    estoqueMinimo: parseFloat(formData.get('estoqueMinimo')),
                };
                showLoader();
                const { error } = await supabaseClient.from('ingredientes').update(updatedData).eq('id', id);
                hideLoader();
                if (error) {
                    showSaveStatus('Erro ao atualizar: ' + error.message, false);
                } else {
                    showSaveStatus('Ingrediente salvo!');
                    await loadDataFromSupabase();
                    closeModal('edit-modal');
                }
            };
        });
    };

    window.removeIngrediente = async id => {
        if (confirm('Remover este ingrediente?')) {
            showLoader();
            const { error } = await supabaseClient.from('ingredientes').delete().eq('id', id);
            hideLoader();
            if (error) {
                showSaveStatus('Erro ao remover: ' + error.message, false);
            } else {
                await loadDataFromSupabase();
            }
        }
    };

    document.getElementById('search-ingredientes').addEventListener('input', renderIngredientes);

    const renderEstoque = () => {
        const searchTerm = document.getElementById('search-estoque').value.toLowerCase();
        let filteredData = database.estoque.filter(item => (item.nome || '').toLowerCase().includes(searchTerm));
        
        const { column, direction } = sortState.estoque;
        filteredData.sort((a, b) => {
            let valA, valB;
            if (column === 'custo' || column === 'lucro') {
                const custoA = calculatePizzaCost(a.id);
                const custoB = calculatePizzaCost(b.id);
                valA = column === 'custo' ? custoA : a.precoVenda - custoA;
                valB = column === 'custo' ? custoB : b.precoVenda - custoB;
            } else {
                valA = a[column] ?? '';
                valB = b[column] ?? '';
            }

            if (typeof valA === 'number') return valA - valB;
            return valA.localeCompare(valB);
        });
        if (direction === 'desc') filteredData.reverse();

        const tbody = document.getElementById('tabela-estoque').querySelector('tbody');
        tbody.innerHTML = '';
        filteredData.forEach(item => {
            const custo = calculatePizzaCost(item.id);
            const lucro = item.precoVenda - custo;
            
            let pedidosPendentes = 0;
            database.pedidos
                .filter(p => p.status === 'Pendente')
                .forEach(p => {
                    p.items.forEach(pedidoItem => {
                        if (pedidoItem.pizzaId === item.id) {
                            pedidosPendentes += pedidoItem.qtd;
                        }
                    });
                });

            const row = tbody.insertRow();
            if(item.qtd <= 0) row.classList.add('low-stock');
            row.innerHTML = `
                <td data-label="Sabor da Pizza">${item.nome}</td>
                <td data-label="Tamanho">${item.tamanho||"N/A"}</td>
                <td data-label="Qtd.">${item.qtd}</td>
                <td data-label="PDS. (Pedidos)">${pedidosPendentes > 0 ? pedidosPendentes : ''}</td>
                <td data-label="Custo Produção" class="admin-only">${formatCurrency(custo)}</td>
                <td data-label="Preço Venda">${formatCurrency(item.precoVenda)}</td>
                <td data-label="Lucro Bruto" class="admin-only" style="color:${lucro>=0?"green":"red"};font-weight:bold;">${formatCurrency(lucro)}</td>
                <td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editEstoque('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="window.removeEstoque('${item.id}')">Remover</button></td>`;
        });
        updateSortHeaders('tabela-estoque', column, direction);
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
            ({ error } = await supabaseClient.from('estoque').update(pizzaData).eq('id', id));
        } else {
            ({ error } = await supabaseClient.from('estoque').insert(pizzaData));
        }
        hideLoader();
        if (error) {
            showSaveStatus('Erro ao salvar pizza: ' + error.message, false);
        } else {
            showSaveStatus('Pizza salva!');
            e.target.reset();
            document.getElementById('estoque-id').value = '';
            await loadDataFromSupabase();
        }
    });

    window.editEstoque = id => {
        const item = database.estoque.find(p => p.id === id);
        if (!item) return;

        const formHTML = `
            <form id="edit-estoque-form">
                <div class="form-group"><label>Sabor da Pizza</label><input type="text" name="nome" value="${item.nome}" required></div>
                <div class="form-group"><label>Tamanho</label>
                    <select name="tamanho" required>
                        <option value="P" ${item.tamanho === 'P' ? 'selected' : ''}>Pequena</option>
                        <option value="G" ${item.tamanho === 'G' ? 'selected' : ''}>Grande</option>
                    </select>
                </div>
                <div class="form-group"><label>Quantidade</label><input type="number" name="qtd" value="${item.qtd}" required></div>
                <div class="form-group"><label>Preço de Venda</label><input type="number" name="precoVenda" value="${item.precoVenda}" step="0.01" required></div>
                <button type="submit">Salvar</button>
            </form>
        `;

        openModal('edit-modal', 'Editar Pizza', formHTML, () => {
            document.getElementById('edit-estoque-form').onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const updatedData = {
                    nome: formData.get('nome'),
                    tamanho: formData.get('tamanho'),
                    qtd: parseInt(formData.get('qtd')),
                    precoVenda: parseFloat(formData.get('precoVenda')),
                };
                showLoader();
                const { error } = await supabaseClient.from('estoque').update(updatedData).eq('id', id);
                hideLoader();
                if (error) {
                    showSaveStatus('Erro ao atualizar: ' + error.message, false);
                } else {
                    showSaveStatus('Pizza salva!');
                    await loadDataFromSupabase();
                    closeModal('edit-modal');
                }
            };
        });
    };

    window.removeEstoque = async id => {
        if (confirm('Remover esta pizza? Isso também removerá receitas associadas.')) {
            showLoader();
            const { error } = await supabaseClient.from('estoque').delete().eq('id', id);
            hideLoader();
            if (error) {
                showSaveStatus('Erro ao remover pizza: ' + error.message, false);
            } else {
                await loadDataFromSupabase();
            }
        }
    };

    document.getElementById('search-estoque').addEventListener('input', renderEstoque);

    const renderReceitaIngredientesList = () => {
        const container = document.getElementById('receita-ingredientes-list');
        container.innerHTML = '';
        if (receitaAtualIngredientes) {
            receitaAtualIngredientes.forEach((item, index) => {
                const ingrediente = database.ingredientes.find(i => i.id === item.ingredienteId);
                container.innerHTML += `<div class="receita-ingrediente-item"><p><span>${(item.qtd||0).toFixed(3)} x</span> ${ingrediente?ingrediente.nome:"Ingrediente removido"}</p><button type="button" class="btn-remove-item" onclick="window.removeIngredienteDaReceita(${index})">X</button></div>`;
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
            row.innerHTML = `<td data-label="Pizza">${pizza.nome} (${pizza.tamanho||''})</td><td data-label="Ingredientes"><small>${ingredientesList}</small></td><td data-label="Custo Total" class="admin-only">${formatCurrency(custoTotal)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editReceita('${receita.pizzaId}')">Editar</button><button class="action-btn remove-btn" onclick="window.removeReceita('${receita.pizzaId}')">Remover</button></td>`;
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
        hideLoader();
        if (error) {
            showSaveStatus('Erro ao salvar receita: ' + error.message, false);
        } else {
            showSaveStatus('Receita salva!');
            receitaAtualIngredientes = [];
            renderReceitaIngredientesList();
            document.getElementById('form-receita').reset();
            document.getElementById('receita-ingrediente-select').value = '';
            document.getElementById('receita-ingrediente-qtd').value = '';
            await loadDataFromSupabase();
        }
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
            hideLoader();
            if (error) {
                showSaveStatus('Erro ao remover receita: ' + error.message, false);
            } else {
                await loadDataFromSupabase();
            }
        }
    };
    document.getElementById('search-receitas').addEventListener('input', renderReceitas);

    const getFilteredPedidos = (filterRange = 'all') => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1) );
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return database.pedidos.filter(p => {
            if (p.status !== 'Concluído') return false;
            const pDate = new Date(p.dataEntrega);
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
        if(!document.getElementById('balancoChart')) return;
        renderBalancoChart(filteredPedidos);
        renderPizzasMaisLucrativasChart(filteredPedidos);
        renderVendasPorVendedorChart(filteredPedidos);
        renderPizzasMaisVendidasChart(filteredPedidos);
        renderVendasPorDiaChart(filteredPedidos);
    };

    const renderBalancoChart=(t)=>{const e=t.reduce((t,e)=>t+Number(e.valorFinal),0),a=t.reduce((t,e)=>{const a=e.items.reduce((t,a)=>{if(a.isCustom)return t;const r=calculatePizzaCost(a.pizzaId);return t+r*a.qtd},0);return t+a},0),r=e-a,o=document.getElementById("balancoChart").getContext("2d");chartInstances.balanco=new Chart(o,{type:"bar",data:{labels:["Balanço Financeiro"],datasets:[{label:"Receita Total",data:[e],backgroundColor:"#2ecc71"},{label:"Custo Total",data:[a],backgroundColor:"#e74c3c"},{label:"Lucro Total",data:[r],backgroundColor:"#3498db"}]},options:{indexAxis:"y",responsive:!0,scales:{x:{ticks:{callback:t=>formatCurrency(t)}}}}})};
    const renderPizzasMaisLucrativasChart=(t)=>{const e=t.flatMap(t=>t.items).reduce((t,e)=>{if(e.isCustom)return t;const a=calculatePizzaCost(e.pizzaId),r=(e.preco-a)*e.qtd;return t[e.pizzaNome]=(t[e.pizzaNome]||0)+r,t},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]).slice(0,10),r=a.map(t=>e[t]),o=document.getElementById("pizzasMaisLucrativasChart").getContext("2d");chartInstances.lucro=new Chart(o,{type:"doughnut",data:{labels:a,datasets:[{data:r,backgroundColor:["#2ecc71","#3498db","#9b59b6","#f1c40f","#e67e22","#1abc9c"]}]},options:{responsive:!0,plugins:{legend:{position:"top"},tooltip:{callbacks:{label:t=>`${t.label}: ${formatCurrency(t.raw)}`}}}}})};
    const renderVendasPorVendedorChart=(t)=>{const e=t.reduce((t,e)=>{if(e.vendedor)t[e.vendedor]=(t[e.vendedor]||0)+Number(e.valorFinal);return t},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]),r=a.map(t=>e[t]),o=document.getElementById("vendasPorVendedorChart").getContext("2d");chartInstances.vendedor=new Chart(o,{type:"bar",data:{labels:a,datasets:[{label:"Total Vendido",data:r,backgroundColor:"#487eb0"}]},options:{responsive:!0,scales:{y:{ticks:{callback:t=>formatCurrency(t)}}}}})};
    const renderPizzasMaisVendidasChart=(t)=>{const e=t.flatMap(t=>t.items).reduce((t,e)=>{return e.isCustom?t:(t[e.pizzaNome]=(t[e.pizzaNome]||0)+e.qtd,t)},{}),a=Object.keys(e).sort((t,a)=>e[a]-e[t]).slice(0,10),r=a.map(t=>e[t]),o=document.getElementById("pizzasMaisVendidasChart").getContext("2d");chartInstances.vendas=new Chart(o,{type:"pie",data:{labels:a,datasets:[{data:r,backgroundColor:["#e74c3c","#3498db","#f1c40f","#2ecc71","#9b59b6","#1abc9c"]}]},options:{responsive:!0,plugins:{legend:{position:"top"}}}})};
    const renderVendasPorDiaChart=(t)=>{const e=t.reduce((t,e)=>{const a=new Date(e.dataEntrega+"T00:00:00").toLocaleDateString("pt-BR");return t[a]=(t[a]||0)+Number(e.valorFinal),t},{}),a=Object.keys(e).sort((t,a)=>new Date(t.split("/").reverse().join("-"))-new Date(a.split("/").reverse().join("-"))),r=a.map(t=>e[t]),o=document.getElementById("vendasPorDiaChart").getContext("2d");chartInstances.dia=new Chart(o,{type:"line",data:{labels:a,datasets:[{label:"Receita por Dia",data:r,borderColor:"#2c3e50",tension:.1,fill:!1}]},options:{responsive:!0,scales:{y:{ticks:{callback:t=>formatCurrency(t)}}}}})};

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
                    flatData.push({ "ID Pedido": p.id, "Cliente": p.cliente, "Telefone": p.telefone, "Vendedor": p.vendedor, "Cidade": p.cidade, "Semana Entrega": new Date(p.dataEntrega + 'T00:00:00').toLocaleDateString('pt-BR'), "Status": p.status, "Pagamento": p.pagamento, "Item Pizza": item.pizzaNome, "Item Qtd": item.qtd, "Valor Final Pedido": p.valorFinal });
                });
            }
        });
        exportToExcel(flatData, 'sasses_pedidos_detalhado');
    });
    
    document.getElementById('btn-lista-compras').addEventListener('click', () => {
        const itemsBaixos = database.ingredientes.filter(i => i.qtd < i.estoqueMinimo);
        let contentHTML = '<p>Ótima notícia! Nenhum ingrediente está com estoque baixo.</p>';
        
        if(itemsBaixos.length > 0) {
            contentHTML = `<table><thead><tr><th>Ingrediente</th><th>Estoque Atual</th><th>Estoque Mínimo</th><th>Comprar (sugestão)</th></tr></thead><tbody>`;
            itemsBaixos.forEach(item => {
                const comprar = (item.estoqueMinimo - item.qtd).toFixed(3);
                contentHTML += `<tr><td>${item.nome}</td><td>${item.qtd.toFixed(3)}</td><td>${item.estoqueMinimo.toFixed(3)}</td><td><b>${comprar}</b></td></tr>`;
            });
            contentHTML += '</tbody></table>';
        }
        openModal('modal-lista-compras', 'Lista de Compras Sugerida', contentHTML);
    });
    
    document.getElementById('btn-print-lista').addEventListener('click', () => window.print());
    
    document.getElementById('form-producao').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pizzaId = document.getElementById('producao-pizza-select').value;
        const quantidade = parseInt(document.getElementById('producao-qtd').value);

        if(!pizzaId || !quantidade || !quantidade > 0) {
            alert('Por favor, selecione uma pizza e informe uma quantidade válida.');
            return;
        }
        
        const pizza = database.estoque.find(p=>p.id === pizzaId);
        if(!confirm(`Confirma a produção de ${quantidade}x ${pizza.nome}? Isso dará baixa nos ingredientes.`)) {
            return;
        }

        showLoader();
        const { data: receita } = await supabaseClient.from('receitas').select('ingredientes').eq('pizzaId', pizzaId).single();

        if (!receita || !receita.ingredientes) {
            hideLoader();
            showSaveStatus('Receita não encontrada para esta pizza.', false);
            return;
        }

        const ingredientUpdates = [];
        for (const itemReceita of receita.ingredientes) {
            const ingredienteDB = database.ingredientes.find(i => i.id === itemReceita.ingredienteId);
            const qtdNecessaria = itemReceita.qtd * quantidade;
            if (!ingredienteDB || ingredienteDB.qtd < qtdNecessaria) {
                hideLoader();
                showSaveStatus(`Estoque insuficiente para: ${ingredienteDB ? ingredienteDB.nome : 'desconhecido'}.`, false);
                return;
            }
            ingredientUpdates.push({ id: ingredienteDB.id, newQty: ingredienteDB.qtd - qtdNecessaria });
        }
        
        try {
            await Promise.all(ingredientUpdates.map(upd => 
                supabaseClient.from('ingredientes').update({ qtd: upd.newQty }).eq('id', upd.id)
            ));
            
            const pizzaEstoque = database.estoque.find(p => p.id === pizzaId);
            await supabaseClient.from('estoque').update({ qtd: pizzaEstoque.qtd + quantidade }).eq('id', pizzaId);

            showSaveStatus('Produção registrada e estoques atualizados!');
            await loadDataFromSupabase();
        } catch (error) {
            showSaveStatus(`Erro ao registrar produção: ${error.message}`, false);
        } finally {
            hideLoader();
        }
        
        e.target.reset();
    });

    document.getElementById('export-demanda').addEventListener('click', () => {
        const demand = {};
        database.pedidos
            .filter(p => p.status === 'Pendente')
            .forEach(p => {
                p.items.forEach(item => {
                    demand[item.pizzaNome] = (demand[item.pizzaNome] || 0) + item.qtd;
                });
            });
        
        const dataForExcel = Object.entries(demand).map(([Sabor, Quantidade]) => ({ Sabor, Quantidade }));
        exportToExcel(dataForExcel, 'demanda_de_producao');
    });
    
    window.openEditPedidoModal = (id) => {
        const pedido = database.pedidos.find(p => p.id === id);
        if (!pedido) return;

        pedidoEditItems = JSON.parse(JSON.stringify(pedido.items));

        const pizzaOptions = database.estoque.map(p => {
            const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
            const stockStyle = (p.qtd <= 0) ? 'color:red;' : '';
            return `<option value="${p.id}" style="${stockStyle}">${label} (Estoque: ${p.qtd})</option>`;
        }).join('');

        const formHTML = `
            <form id="edit-pedido-form" class="form-vertical">
                <input type="hidden" name="id" value="${pedido.id}">
                <div class="form-group"><label>Cliente</label><input type="text" name="cliente" value="${pedido.cliente}" required></div>
                <div class="form-group"><label>Telefone</label><input type="text" name="telefone" value="${pedido.telefone || ''}"></div>
                <div class="form-group"><label>Cidade</label><input type="text" name="cidade" value="${pedido.cidade}" required></div>
                <div class="form-group"><label>Vendedor</label><input type="text" name="vendedor" value="${pedido.vendedor}" required></div>
                <div class="form-group">
                    <label>Pagamento</label>
                    <select name="pagamento" required>
                        <option value="Dinheiro" ${pedido.pagamento === 'Dinheiro' ? 'selected' : ''}>Dinheiro</option>
                        <option value="Cartão de Crédito" ${pedido.pagamento === 'Cartão de Crédito' ? 'selected' : ''}>Cartão de Crédito</option>
                        <option value="Cartão de Débito" ${pedido.pagamento === 'Cartão de Débito' ? 'selected' : ''}>Cartão de Débito</option>
                        <option value="Pix" ${pedido.pagamento === 'Pix' ? 'selected' : ''}>Pix</option>
                    </select>
                </div>
                 <div class="form-group">
                    <label>Status</label>
                    <select name="status" required>
                        <option value="Pendente" ${pedido.status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                        <option value="Pronto" ${pedido.status === 'Pronto' ? 'selected' : ''}>Pronto</option>
                        <option value="Concluído" ${pedido.status === 'Concluído' ? 'selected' : ''}>Concluído</option>
                    </select>
                </div>
                <hr>
                <h4>Itens do Pedido</h4>
                <div id="edit-item-pedido" style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; margin-bottom:1rem;">
                    <select id="edit-item-pizza" style="flex:2;"><option value="">Selecione a Pizza...</option>${pizzaOptions}</select>
                    <input type="number" id="edit-item-qtd" placeholder="Qtd" value="1" min="1" style="flex:1;">
                    <button type="button" id="btn-add-item-edit-pedido">Adicionar</button>
                </div>
                <div id="edit-pedido-itens-carrinho" class="carrinho-container"></div>
                 <div class="resumo-pedido">
                    <span>Total Calculado: <b id="total-calculado-edit-pedido">R$ 0,00</b></span>
                    <input type="number" id="valor-final-edit-pedido" placeholder="Valor Final" step="0.01" value="${pedido.valorFinal || ''}">
                </div>
                <button type="submit">Salvar Alterações</button>
            </form>
        `;

        openModal('edit-modal', `Editar Pedido de ${pedido.cliente}`, formHTML, () => {
            renderEditPedidoCarrinho();
            updateTotalEditPedido();

            document.getElementById('btn-add-item-edit-pedido').addEventListener('click', () => {
                const pizzaSelect = document.getElementById('edit-item-pizza');
                const pizzaId = pizzaSelect.value;
                const qtd = parseInt(document.getElementById('edit-item-qtd').value);
                if (!pizzaId || !qtd || qtd < 1) return;

                const pizzaData = database.estoque.find(p => p.id === pizzaId);
                pedidoEditItems.push({ pizzaId, pizzaNome: pizzaData.tamanho ? `${pizzaData.nome} (${pizzaData.tamanho})` : pizzaData.nome, qtd, isCustom: false, preco: pizzaData.precoVenda });
                
                renderEditPedidoCarrinho();
                updateTotalEditPedido();
                
                pizzaSelect.value = '';
                document.getElementById('edit-item-qtd').value = '1';
            });

            document.getElementById('edit-pedido-form').onsubmit = async (e) => {
                e.preventDefault();
                await handleUpdatePedido(pedido);
            };
        });
    };

    const renderEditPedidoCarrinho = () => {
        const container = document.getElementById('edit-pedido-itens-carrinho');
        container.innerHTML = '<p style="text-align:center;color:#777">Nenhuma pizza adicionada.</p>';
        if (pedidoEditItems.length > 0) {
            container.innerHTML = '';
            pedidoEditItems.forEach((item, index) => {
                container.innerHTML += `<div class="carrinho-item"><p><span>${item.qtd}x</span> ${item.pizzaNome}</p><button type="button" class="btn-remove-item" onclick="window.removeEditItemPedido(${index})">X</button></div>`;
            });
        }
    };
    
    window.removeEditItemPedido = (index) => {
        pedidoEditItems.splice(index, 1);
        renderEditPedidoCarrinho();
        updateTotalEditPedido();
    };

    const updateTotalEditPedido = () => {
        const total = pedidoEditItems.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
        document.getElementById('total-calculado-edit-pedido').textContent = formatCurrency(total);
        const valorFinalInput = document.getElementById('valor-final-edit-pedido');
        if(!valorFinalInput.value) {
            valorFinalInput.value = total.toFixed(2);
        }
    };

    const handleUpdatePedido = async (originalPedido) => {
        if (!confirm('Tem certeza que deseja salvar as alterações? O estoque será reconciliado.')) return;
        showLoader();

        const form = document.getElementById('edit-pedido-form');
        const formData = new FormData(form);
        const valorFinal = parseFloat(formData.get('valor-final-edit-pedido'));
        const valorCalculado = pedidoEditItems.reduce((acc, item) => acc + (item.preco * item.qtd), 0);

        const updatedPedidoData = {
            cliente: formData.get('cliente'),
            telefone: formData.get('telefone'),
            cidade: formData.get('cidade'),
            vendedor: formData.get('vendedor'),
            pagamento: formData.get('pagamento'),
            status: formData.get('status'),
            items: pedidoEditItems,
            valorTotal: valorCalculado,
            valorFinal: isNaN(valorFinal) ? valorCalculado : valorFinal,
        };
        
        try {
            const { error: updateError } = await supabaseClient.from('pedidos').update(updatedPedidoData).eq('id', originalPedido.id);
            if (updateError) throw updateError;
            
            showSaveStatus('Pedido atualizado com sucesso!');
            closeModal('edit-modal');
            await loadDataFromSupabase();

        } catch (error) {
            console.error("Erro ao atualizar pedido:", error);
            showSaveStatus(`Erro ao atualizar pedido: ${error.message}`, false);
        } finally {
            hideLoader();
        }
    };
    
    loadDataFromSupabase();
});
