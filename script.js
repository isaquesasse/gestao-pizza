document.addEventListener("DOMContentLoaded", () => {
  const SUPABASE_URL = "https://iprnfzevdfmnraexthpy.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlwcm5memV2ZGZtbnJhZXh0aHB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2NTE1NTAsImV4cCI6MjA2NzIyNzU1MH0.h5Omsd0XsRtAmOErRCpaqg91OkF53lB8WE9dYlVdRbo";
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const LOADER = document.getElementById("loader");
  const SAVE_STATUS = document.getElementById("save-status");

 
  if (localStorage.getItem("isAdminLoggedIn") === "true") {
    document.body.classList.add("admin-mode");
    document.getElementById("btn-admin-view").textContent = "Sair da Visão ADM";
  }

  let database = {
    ingredientes: [],
    receitas: [],
    estoque: [],
    pedidos: [],
    clientes: [],
    massas: [],
    massas_semanais: [],
  };

  let sortState = {
    pedidos: { column: "dataEntrega", direction: "desc" },
    clientes: { column: "nome", direction: "asc" },
    estoque: { column: "nome", direction: "asc" },
    ingredientes: { column: "nome", direction: "asc" },
    demanda: { column: "quantidade", direction: "desc" },
    sobras: { column: "sobraProj", direction: "asc" },
  };

  let pedidoAtualItems = [];
  let pedidoEditItems = [];
  let receitaAtualIngredientes = [];
  let saveStatusTimeout;
  const chartInstances = {};
  let currentDateForCalendar = new Date();

  const showLoader = () => (LOADER.style.display = "flex");
  const hideLoader = () => (LOADER.style.display = "none");

  const showSaveStatus = (message, isSuccess = true) => {
    clearTimeout(saveStatusTimeout);
    SAVE_STATUS.textContent = message;
    SAVE_STATUS.className = `visible ${isSuccess ? "success" : "error"}`;
    saveStatusTimeout = setTimeout(() => {
      SAVE_STATUS.className = "";
    }, 4000);
  };

  const formatCurrency = (value) => {
    if (isNaN(value) || value === null) value = 0;
    return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
  };

  const formatDateToYYYYMMDD = (date) => {
    const d = new Date(date);
    const userTimezoneOffset = d.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(d.getTime() + userTimezoneOffset);
    const year = adjustedDate.getFullYear();
    const month = String(adjustedDate.getMonth() + 1).padStart(2, "0");
    const day = String(adjustedDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getWeekStart = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : new Date();
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setUTCDate(diff));
    const year = monday.getUTCFullYear();
    const month = String(monday.getUTCMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(monday.getUTCDate()).padStart(2, "0");

    return `${year}-${month}-${dayOfMonth}`;
  };

  const calculatePizzaCost = (
    pizzaId,
    ingredientsSource = database.ingredientes
  ) => {
    const receita = database.receitas.find((r) => r.pizzaId === pizzaId);
    if (!receita || !receita.ingredientes) return 0;
    return receita.ingredientes.reduce((total, itemReceita) => {
      const ingrediente = ingredientsSource.find(
        (i) => i.id === itemReceita.ingredienteId
      );
      return total + (ingrediente ? ingrediente.custo * itemReceita.qtd : 0);
    }, 0);
  };

  const loadDataFromSupabase = async () => {
    showLoader();
    try {
      const results = await Promise.all([
        supabaseClient.from("ingredientes").select("*").order("nome"),
        supabaseClient.from("estoque").select("*").order("nome"),
        supabaseClient.from("receitas").select("*"),
        supabaseClient
          .from("pedidos")
          .select("*")
          .order("created_at", { ascending: false }),
        supabaseClient.from("clientes").select("*").order("nome"),
        supabaseClient.from("massas").select("*"),
        supabaseClient.from("massas_semanais").select("*"),
      ]);

      const errors = results.map((r) => r.error).filter(Boolean);
      if (errors.length > 0) {
        throw new Error(errors.map((e) => e.message).join("\n"));
      }

      database.ingredientes = results[0].data || [];
      database.estoque = results[1].data || [];
      database.receitas = results[2].data || [];
      database.pedidos = results[3].data || [];
      database.clientes = results[4].data || [];
      database.massas = results[5].data || [];
      database.massas_semanais = results[6].data || [];

      await syncClientsFromOrders();
      renderAll();
    } catch (error) {
      console.error("Erro ao carregar dados do Supabase:", error);
      showSaveStatus("Falha ao carregar dados. Verifique o console.", false);
    } finally {
      hideLoader();
    }
  };

  const syncClientsFromOrders = async () => {
    const existingClientKeys = new Set(
      database.clientes.map(
        (c) => `${c.nome.toLowerCase()}|${c.cidade.toLowerCase()}`
      )
    );
    const newClientsMap = new Map();

    database.pedidos.forEach((pedido) => {
      if (pedido.cliente && pedido.cidade) {
        const clientKey = `${pedido.cliente.toLowerCase()}|${pedido.cidade.toLowerCase()}`;
        if (
          !existingClientKeys.has(clientKey) &&
          !newClientsMap.has(clientKey)
        ) {
          newClientsMap.set(clientKey, {
            nome: pedido.cliente,
            cidade: pedido.cidade,
            telefone: pedido.telefone || null,
          });
        }
      }
    });

    const clientsToUpsert = Array.from(newClientsMap.values());

    if (clientsToUpsert.length > 0) {
      console.log(
        `Sincronizando ${clientsToUpsert.length} novo(s) cliente(s)...`
      );
      const { data, error } = await supabaseClient
        .from("clientes")
        .upsert(clientsToUpsert, { onConflict: "nome,cidade" })
        .select();
      if (error) {
        console.error("Erro ao sincronizar clientes:", error);
        showSaveStatus("Erro ao sincronizar clientes antigos.", false);
      }
      if (data) {
        database.clientes = [...database.clientes, ...data];
      }
    }
  };

  const renderAll = () => {
    populateSelects();
    populateWeekSelector();
    populateWeekSelector(document.getElementById("filter-demanda-semana"));
    renderIngredientes();
    renderEstoque();
    renderReceitas();

    const statusSelect = document.getElementById("filter-modal-status"); 
    if (statusSelect && !statusSelect.value) {
    }

    renderPedidos();
    renderClientes();
    renderProductionDemand();
    renderWeeklyMassasPanel();
    renderConsultaRapidaSobras();
    populateClienteDatalist();
    renderDashboard(
      document.querySelector(".date-filter.active")?.dataset.range || "all"
    );
  };

  const populateSelects = (selectElementId) => {
    const pizzaEstoqueSelect = document.getElementById(
      selectElementId || "item-pizza"
    );
    if (!pizzaEstoqueSelect) return;
    const firstOption = pizzaEstoqueSelect.options[0];
    pizzaEstoqueSelect.innerHTML = "";
    if (firstOption) pizzaEstoqueSelect.appendChild(firstOption);

    database.estoque.forEach((p) => {
      const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
      const stockStyle = p.qtd <= 0 ? "color:red;" : "";
      pizzaEstoqueSelect.innerHTML += `<option value="${p.id}" style="${stockStyle}">${label} (Estoque: ${p.qtd})</option>`;
    });
    pizzaEstoqueSelect.innerHTML += '<option value="outro">Outro...</option>';

    if (!selectElementId) {
      ["producao-pizza-select", "receita-pizza-select"].forEach((id) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const firstOpt = sel.options[0];
        sel.innerHTML = "";
        if (firstOpt) sel.appendChild(firstOpt);
        database.estoque.forEach((p) => {
          const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
          sel.innerHTML += `<option value="${p.id}">${label}</option>`;
        });
      });
      const ingredienteReceitaSelect = document.getElementById(
        "receita-ingrediente-select"
      );
      if (!ingredienteReceitaSelect) return;
      const firstOpt = ingredienteReceitaSelect.options[0];
      ingredienteReceitaSelect.innerHTML = "";
      if (firstOpt) ingredienteReceitaSelect.appendChild(firstOpt);
      database.ingredientes.forEach((i) => {
        ingredienteReceitaSelect.innerHTML += `<option value="${i.id}">${i.nome}</option>`;
      });
    }
  };

  const populateWeekSelector = (selectElement) => {
    const weekSelect =
      selectElement || document.getElementById("pedido-semana-entrega");
    if (!weekSelect) return;
    const firstOption = weekSelect.options[0];
    weekSelect.innerHTML = "";
    if (firstOption) weekSelect.appendChild(firstOption);

    for (let i = 0; i < 12; i++) {
      let weekDate = new Date();
      weekDate.setDate(weekDate.getDate() + i * 7);

      let startOfWeek = new Date(
        weekDate.setDate(
          weekDate.getDate() -
          weekDate.getDay() +
          (weekDate.getDay() === 0 ? -6 : 1)
        )
      );
      let endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);

      const startFormatted = startOfWeek.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      });
      const endFormatted = endOfWeek.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      });
      const weekValue = formatDateToYYYYMMDD(startOfWeek);

      weekSelect.innerHTML += `<option value="${weekValue}">Semana de ${startFormatted} a ${endFormatted}</option>`;
    }
  };

  const populateClienteDatalist = () => {
    const datalist = document.getElementById("clientes-list");
    if (!datalist) return;
    datalist.innerHTML = "";
    database.clientes.forEach((cliente) => {
      datalist.innerHTML += `<option value="${cliente.nome}">`;
    });
  };


  document.querySelectorAll(".tab-link").forEach((link) => {
    link.addEventListener("click", () => {
      const tabId = link.dataset.tab;
      document
        .querySelectorAll(".tab-link")
        .forEach((l) => l.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((c) => c.classList.remove("active"));
      link.classList.add("active");
      document.getElementById(tabId).classList.add("active");
      if (tabId === "graficos") {
        renderProductionDemand();

        renderDashboard(
          document.querySelector(".date-filter.active")?.dataset.range || "all"
        );
      }
    });
  });

  const openAuthModal = () => {
    document.getElementById("auth-error").style.display = "none";
    document.getElementById("admin-password").value = "";
    document.getElementById("auth-modal").style.display = "block";
    document.getElementById("admin-password").focus();
  };

  const closeAuthModal = () => {
    document.getElementById("auth-modal").style.display = "none";
  };

  const toggleAdminView = () => {
    const body = document.body;
    const btn = document.getElementById("btn-admin-view");

    if (body.classList.contains("admin-mode")) {
      localStorage.removeItem("isAdminLoggedIn");
      body.classList.remove("admin-mode");
      btn.textContent = "Visão ADM";
      const activeTabIsAdminOnly = document.querySelector(
        ".tab-link.active.admin-only"
      );
      if (activeTabIsAdminOnly) {
        document.querySelector('.tab-link[data-tab="pedidos"]').click();
      }
    } else {
      openAuthModal();
    }
  };
  document
    .getElementById("btn-admin-view")
    .addEventListener("click", toggleAdminView);

  document.getElementById("auth-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const password = document.getElementById("admin-password").value;
    const errorEl = document.getElementById("auth-error");

    if (password === "sasse") {
      localStorage.setItem("isAdminLoggedIn", "true");
      document.body.classList.add("admin-mode");
      document.getElementById("btn-admin-view").textContent =
        "Sair da Visão ADM";
      errorEl.style.display = "none";
      closeAuthModal();
    } else {
      errorEl.textContent = "Senha incorreta. Tente novamente.";
      errorEl.style.display = "block";
    }
  });

  window.openModal = (modalId, title, contentHTML, callback) => {
    const modal = document.getElementById(modalId);
    const modalTitle = document.getElementById(`${modalId}-title`);
    const contentContainer = document.getElementById(`${modalId}-content`);

    if (modalTitle) modalTitle.textContent = title;
    if (contentContainer) contentContainer.innerHTML = contentHTML;

    if (callback) {
      callback();
    }
    modal.style.display = "block";
  };

  window.closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = "none";
      const contentContainer = document.getElementById(`${modalId}-content`);
      if (contentContainer) contentContainer.innerHTML = "";
    }
  };

  const renderClientes = () => {
    const tbody = document
      .getElementById("tabela-clientes")
      ?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document
      .getElementById("search-clientes")
      .value.toLowerCase();
    let filteredData = database.clientes.filter(
      (c) =>
        (c.nome || "").toLowerCase().includes(searchTerm) ||
        (c.cidade || "").toLowerCase().includes(searchTerm) ||
        (c.telefone || "").toLowerCase().includes(searchTerm)
    );

    const { column, direction } = sortState.clientes;
    filteredData.sort((a, b) => {
      const valA = a[column] ?? "";
      const valB = b[column] ?? "";
      if (typeof valA === "number") return valA - valB;
      return (valA || "").localeCompare(valB || "");
    });
    if (direction === "desc") filteredData.reverse();

    tbody.innerHTML = "";
    filteredData.forEach((c) => {
      const row = tbody.insertRow();
      row.innerHTML = `
                <td data-label="Nome do Cliente">${c.nome}</td>
                <td data-label="Telefone">${c.telefone || "N/A"}</td>
                <td data-label="Cidade">${c.cidade || "N/A"}</td>
                <td data-label="Ações">
                    <button class="action-btn history-btn" onclick="openHistoryModal('${c.id
        }')">Histórico</button>
                    <button class="action-btn edit-btn" onclick="openEditClientModal('${c.id
        }')">Editar</button>
                </td>
            `;
    });
    updateSortHeaders("tabela-clientes", column, direction);
  };

  window.openEditClientModal = (id) => {
    const cliente = database.clientes.find((c) => c.id === id);
    if (!cliente) return;
    const formHTML = `
            <form id="edit-client-form">
                <input type="hidden" name="id" value="${cliente.id}">
                <div class="form-group">
                    <label for="edit-cliente-nome">Nome</label>
                    <input type="text" id="edit-cliente-nome" name="nome" value="${cliente.nome || ""
      }" required>
                </div>
                <div class="form-group">
                    <label for="edit-cliente-telefone">Telefone</label>
                    <input type="text" id="edit-cliente-telefone" name="telefone" value="${cliente.telefone || ""
      }">
                </div>
                <div class="form-group">
                    <label for="edit-cliente-cidade">Cidade</label>
                    <input type="text" id="edit-cliente-cidade" name="cidade" value="${cliente.cidade || ""
      }" required>
                </div>
                <button type="submit">Salvar Alterações</button>
            </form>
        `;
    openModal("edit-modal", "Editar Cliente", formHTML, () => {
      document.getElementById("edit-client-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const updatedData = Object.fromEntries(formData.entries());
        showLoader();
        const { error } = await supabaseClient
          .from("clientes")
          .update({
            nome: updatedData.nome,
            telefone: updatedData.telefone,
            cidade: updatedData.cidade,
          })
          .eq("id", updatedData.id);
        hideLoader();
        if (error) {
          showSaveStatus("Erro ao atualizar cliente: " + error.message, false);
        } else {
          showSaveStatus("Cliente atualizado com sucesso!");
          await loadDataFromSupabase();
          closeModal("edit-modal");
        }
      };
    });
  };

  window.openHistoryModal = (clientId) => {
    const cliente = database.clientes.find((c) => c.id === clientId);
    if (!cliente) return;

    const pedidosCliente = database.pedidos
      .filter((p) => p.clienteId === clientId)
      .sort((a, b) => new Date(b.dataEntrega) - new Date(a.dataEntrega));

    let tableHTML = "<p>Nenhum pedido encontrado para este cliente.</p>";
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
      pedidosCliente.forEach((p) => {
        const itemsHtml = p.items
          .map((i) => `<li>${i.qtd}x ${i.pizzaNome}</li>`)
          .join("");
        const startOfWeek = new Date(p.dataEntrega);
        const weekStartFormatted = startOfWeek.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
        });
        const valorExibido = p.valorFinal || p.valorTotal;
        tableHTML += `
                    <tr>
                        <td>${weekStartFormatted}</td>
                        <td><ul>${itemsHtml}</ul></td>
                        <td>${formatCurrency(valorExibido)}</td>
                        <td><span class="status-${(
            p.status || "pendente"
          ).toLowerCase()}">${p.status}</span></td>
                    </tr>
                `;
      });
      tableHTML += "</tbody></table>";
    }
    openModal("history-modal", `Histórico de ${cliente.nome}`, tableHTML);
  };

  document
    .getElementById("search-clientes")
    ?.addEventListener("input", renderClientes);

  const renderPedidos = () => {
    const tbody = document
      .getElementById("tabela-pedidos")
      ?.querySelector("tbody");
    if (!tbody) return;

    const searchTerm = document
      .getElementById("search-pedidos")
      .value.toLowerCase();

    const clienteFilter = document.getElementById("filter-modal-cliente").value.toLowerCase();
    const cidadeFilter = document.getElementById("filter-modal-cidade").value.toLowerCase();
    const vendedorFilter = document.getElementById("filter-modal-vendedor").value;
    const semanaFilter = document.getElementById("filter-modal-semana").value;
    const statusFilter = document.getElementById("filter-modal-status").value;
    const valorMin = parseFloat(document.getElementById("filter-modal-valor-min").value) || 0;
    const valorMax = parseFloat(document.getElementById("filter-modal-valor-max").value) || Infinity;

    let filteredData = database.pedidos.filter((p) => {
        const searchMatch = (p.cliente || "").toLowerCase().includes(searchTerm);

        const clienteMatch = !clienteFilter || (p.cliente || "").toLowerCase().includes(clienteFilter);
        const cidadeMatch = !cidadeFilter || (p.cidade || "").toLowerCase().includes(cidadeFilter);

        const vendedorFirstName = (p.vendedor || "").trim().split(" ")[0];
        const normalizedVendedor =
            vendedorFirstName.charAt(0).toUpperCase() +
            vendedorFirstName.slice(1).toLowerCase();
        const vendedorMatch =
            !vendedorFilter || normalizedVendedor === vendedorFilter;
        
        const semanaMatch = !semanaFilter || (p.dataEntrega && getWeekStart(p.dataEntrega) === semanaFilter);
        const statusMatch = !statusFilter || p.status === statusFilter;

        const valorExibido = p.valorFinal || p.valorTotal;
        const valorMatch = valorExibido >= valorMin && valorExibido <= valorMax;

        return searchMatch && clienteMatch && cidadeMatch && vendedorMatch && semanaMatch && statusMatch && valorMatch;
    });

    const { column, direction } = sortState.pedidos;
    filteredData.sort((a, b) => {
        const valA = a[column] ?? "";
        const valB = b[column] ?? "";
        if (column === "dataEntrega") return new Date(valA) - new Date(valB);
        if (typeof valA === "number") return valA - valB;
        return (valA || "").localeCompare(valB || "");
    });
    if (direction === "desc") filteredData.reverse();

    tbody.innerHTML = "";
    filteredData.forEach((p) => {
        const row = tbody.insertRow();
        const itemsHtml = p.items
            .map(
                (i) =>
                    `<li class="${i.isCustom ? "item-pedido-outro" : ""}">${i.qtd}x ${i.pizzaNome
                    }</li>`
            )
            .join("");
        const statusClass = (p.status || "pendente")
            .toLowerCase()
            .replace(/ /g, "-");
        const startOfWeek = new Date(p.dataEntrega);
        const weekStartFormatted = startOfWeek.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
        });
        const valorExibido = p.valorFinal || p.valorTotal;

        row.innerHTML = `
                <td data-label="Cliente">${p.cliente}</b><br><small>${p.telefone || "N/A"
            }</small></td>
                <td data-label="Semana Entrega">${weekStartFormatted}</td>
                <td data-label="Itens"><ul style="padding-left:15px;margin:0">${itemsHtml}</ul></td>
                <td data-label="Detalhes"><small>Vend.: ${p.vendedor
            }<br>Cid.: ${p.cidade}<br>Pag.: ${p.pagamento}</small></td>
                <td data-label="Valores"><b>${formatCurrency(
                valorExibido
            )}</b><br><small class="admin-only">Calc: ${formatCurrency(
                p.valorTotal
            )}</small></td>
                <td data-label="Status"><span class="status-${statusClass}">${p.status
            }</span></td>
                <td data-label="Ações">${renderActionButtons(p)}</td>
            `;
    });
    updateSortHeaders("tabela-pedidos", column, direction);
  };

  const renderActionButtons = (pedido) => {
    const removerBtn = `<button class="action-btn remove-btn" onclick="window.removerPedido('${pedido.id}')">Remover</button>`;
    const editarBtn = `<button class="action-btn edit-btn" onclick="window.openEditPedidoModal('${pedido.id}')">Editar</button>`;
    switch (pedido.status) {
      case "Pendente":
        return `${editarBtn}<button class="action-btn" style="background-color:var(--accent-color)" onclick="window.updatePedidoStatus('${pedido.id}', 'Pronto')">Marcar Pronto</button>${removerBtn}`;
      case "Pronto":
        return `${editarBtn}<button class="action-btn complete-btn" onclick="window.updatePedidoStatus('${pedido.id}', 'Concluído')">Marcar Concluído</button>${removerBtn}`;
      case "Concluído":
        return `${editarBtn}${removerBtn}`;
      default:
        return removerBtn;
    }
  };

  window.updatePedidoStatus = async (id, newStatus) => {
    if (
      !confirm(`Tem certeza que deseja alterar o status para "${newStatus}"?`)
    )
      return;

    showLoader();

    const pedido = database.pedidos.find((p) => p.id === id);
    if (!pedido) {
      showSaveStatus("Erro: Pedido não encontrado.", false);
      hideLoader();
      return;
    }

    try {
      if (newStatus === "Pronto" && pedido.status !== "Pronto") {
        const stockUpdatePromises = [];
        for (const item of pedido.items) {
          if (!item.isCustom) {
            const pizzaEmEstoque = database.estoque.find(
              (p) => p.id === item.pizzaId
            );
            if (pizzaEmEstoque) {
              const novaQtd = pizzaEmEstoque.qtd - item.qtd;
              stockUpdatePromises.push(
                supabaseClient
                  .from("estoque")
                  .update({ qtd: novaQtd })
                  .eq("id", item.pizzaId)
              );
            }
          }
        }

        const results = await Promise.all(stockUpdatePromises);
        const stockErrors = results.map((r) => r.error).filter(Boolean);
        if (stockErrors.length > 0) {
          throw new Error(
            "Falha ao dar baixa no estoque: " +
            stockErrors.map((e) => e.message).join("\n")
          );
        }
        showSaveStatus("Estoque atualizado!");
      }

      const { error: statusError } = await supabaseClient
        .from("pedidos")
        .update({ status: newStatus })
        .eq("id", id);
      if (statusError) {
        throw statusError;
      }

      showSaveStatus("Status do pedido atualizado com sucesso!");
      await loadDataFromSupabase();
    } catch (error) {
      showSaveStatus(`Erro ao atualizar pedido: ${error.message}`, false);
    } finally {
      hideLoader();
    }
  };

  document
    .getElementById("btn-add-item-pedido")
    ?.addEventListener("click", () => {
      const pizzaSelect = document.getElementById("item-pizza");
      const pizzaId = pizzaSelect.value;
      const qtd = parseInt(document.getElementById("item-qtd").value);
      if (!pizzaId || !qtd || qtd < 1) {
        alert("Selecione uma pizza e informe uma quantidade válida.");
        return;
      }

      let pizzaNome,
        isCustom = false,
        preco = 0;
      if (pizzaId === "outro") {
        pizzaNome = document
          .getElementById("item-pizza-outro-nome")
          .value.trim();
        if (!pizzaNome) {
          alert("Por favor, informe o nome da pizza.");
          return;
        }
        const tamanho = document.getElementById(
          "item-pizza-outro-tamanho"
        ).value;
        pizzaNome = `${pizzaNome} (${tamanho})`;
        isCustom = true;
      } else {
        const pizzaData = database.estoque.find((p) => p.id === pizzaId);
        pizzaNome = pizzaData.tamanho
          ? `${pizzaData.nome} (${pizzaData.tamanho})`
          : pizzaData.nome;
        preco = pizzaData.precoVenda;
      }
      pedidoAtualItems.push({ pizzaId, pizzaNome, qtd, isCustom, preco });
      renderPedidoCarrinho();
      updateTotalPedido();
      pizzaSelect.value = "";
      document.getElementById("item-qtd").value = "1";
      document.getElementById("item-pizza-outro-nome").value = "";
      document.getElementById("item-pizza-outro-nome").classList.add("hidden");
      document
        .getElementById("item-pizza-outro-tamanho")
        .classList.add("hidden");
    });

  const renderPedidoCarrinho = () => {
    const container = document.getElementById("pedido-itens-carrinho");
    if (!container) return;
    container.innerHTML = "";
    if (pedidoAtualItems.length === 0) {
      container.innerHTML =
        '<p style="text-align:center;color:#777">Nenhuma pizza adicionada.</p>';
      return;
    }
    pedidoAtualItems.forEach((item, index) => {
      container.innerHTML += `<div class="carrinho-item"><p><span>${item.qtd
        }x</span> ${item.pizzaNome} ${item.isCustom ? '<b class="item-pedido-outro">(Outro)</b>' : ""
        }</p><button type="button" class="btn-remove-item" onclick="window.removeItemPedido(${index})">X</button></div>`;
    });
  };

  window.removeItemPedido = (index) => {
    pedidoAtualItems.splice(index, 1);
    renderPedidoCarrinho();
    updateTotalPedido();
  };

  const updateTotalPedido = () => {
    const total = pedidoAtualItems.reduce(
      (acc, item) => acc + item.preco * item.qtd,
      0
    );
    document.getElementById("total-calculado-pedido").textContent =
      formatCurrency(total);
    document.getElementById("valor-final-pedido").value = total.toFixed(2);
  };

  document
    .getElementById("btn-registrar-pedido")
    ?.addEventListener("click", async () => {
      await registrarNovoPedido();
    });

  const registrarNovoPedido = async () => {
    if (pedidoAtualItems.length === 0) {
      alert("Adicione pelo menos uma pizza ao pedido.");
      return;
    }
    const clienteNome = document.getElementById("pedido-cliente").value;
    const vendedor = document.getElementById("pedido-vendedor").value;
    const cidade = document.getElementById("pedido-cidade").value;
    const pagamento = document.getElementById("pedido-pagamento").value;
    const dataEntrega = document.getElementById("pedido-semana-entrega").value;
    if (!clienteNome || !pagamento || !vendedor || !cidade || !dataEntrega) {
      alert(
        "Preencha todos os campos do pedido, incluindo a semana de entrega."
      );
      return;
    }

    showLoader();

    let cliente = database.clientes.find(
      (c) =>
        c.nome.toLowerCase() === clienteNome.toLowerCase() &&
        c.cidade.toLowerCase() === cidade.toLowerCase()
    );
    let clienteId;

    if (cliente) {
      clienteId = cliente.id;
    } else {
      const { data, error } = await supabaseClient
        .from("clientes")
        .insert({
          nome: clienteNome,
          telefone: document.getElementById("pedido-cliente-telefone").value,
          cidade: cidade,
        })
        .select()
        .single();
      if (error) {
        showSaveStatus(`Erro ao criar novo cliente: ${error.message}`, false);
        hideLoader();
        return;
      }
      clienteId = data.id;
    }

    const valorCalculado = pedidoAtualItems.reduce(
      (acc, item) => acc + item.preco * item.qtd,
      0
    );
    const valorFinalInput = document.getElementById("valor-final-pedido").value;
    const valorFinal =
      parseFloat(valorFinalInput.replace(",", ".")) || valorCalculado;

    const newPedidoData = {
      cliente: clienteNome,
      clienteId: clienteId,
      telefone: document.getElementById("pedido-cliente-telefone").value,
      vendedor,
      cidade,
      pagamento,
      dataEntrega,
      status: "Pendente",
      items: pedidoAtualItems,
      valorTotal: valorCalculado,
      valorFinal: valorFinal,
    };

    const semanaInicio = getWeekStart(dataEntrega);
    const quotas = database.massas_semanais.find(
      (m) => m.semana_inicio === semanaInicio
    ) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
    const used = computeWeeklyUsage(semanaInicio);

    const newOrderDoughs = { G: 0, P: 0, PC: 0 };
    newPedidoData.items.forEach((item) => {
      if (item.isCustom) return;
      const pizza = database.estoque.find((e) => e.id === item.pizzaId);
      const doughType = mapPizzaToDough(pizza);
      if (doughType) {
        newOrderDoughs[doughType] += Number(item.qtd || 0);
      }
    });

    const exceeds = [];
    if (used.G + newOrderDoughs.G > (quotas.g_semana || 0)) {
      exceeds.push(`G: ${used.G + newOrderDoughs.G}/${quotas.g_semana || 0}`);
    }
    if (used.P + newOrderDoughs.P > (quotas.p_semana || 0)) {
      exceeds.push(`P: ${used.P + newOrderDoughs.P}/${quotas.p_semana || 0}`);
    }
    if (used.PC + newOrderDoughs.PC > (quotas.pc_semana || 0)) {
      exceeds.push(
        `P de Chocolate: ${used.PC + newOrderDoughs.PC}/${quotas.pc_semana || 0
        }`
      );
    }

    if (exceeds.length > 0) {
      hideLoader();
      alert(
        "Limite semanal de massas atingido para: " +
        exceeds.join(" | ") +
        ". Ajuste as quantidades ou a semana."
      );
      return;
    }

    const { data: pedidoSalvo, error: insertError } = await supabaseClient
      .from("pedidos")
      .insert(newPedidoData)
      .select()
      .single();

    if (insertError) {
      showSaveStatus("Erro ao registrar pedido: " + insertError.message, false);
      hideLoader();
      return;
    }

    showSaveStatus("Pedido registrado com sucesso!");
    resetFormPedido();
    await loadDataFromSupabase();
    hideLoader();
  };

  const resetFormPedido = () => {
    const form = document.getElementById("form-pedido-principal");
    if (form) form.reset();

    const editId = document.getElementById("pedido-edit-id");
    if (editId) editId.value = "";

    const valorFinal = document.getElementById("valor-final-pedido");
    if (valorFinal) valorFinal.value = "";

    pedidoAtualItems = [];
    renderPedidoCarrinho();
    updateTotalPedido();
  };

  window.removerPedido = async (id) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    if (!pedido) return;

    if (
      confirm(`Tem certeza que deseja remover o pedido de ${pedido.cliente}?`)
    ) {
      showLoader();

      try {
        const { error: deleteError } = await supabaseClient
          .from("pedidos")
          .delete()
          .eq("id", id);
        if (deleteError) throw deleteError;

        showSaveStatus("Pedido removido.");
        await loadDataFromSupabase();
      } catch (error) {
        showSaveStatus(`Erro ao remover pedido: ${error.message}`, false);
      } finally {
        hideLoader();
      }
    }
  };

  const renderWeeklyMassasPanel = () => {
    const container = document.getElementById("calendario-container");
    if (!container) return;

    const weekOptionsId = "semana-massas-select";
    container.innerHTML = `
            <div class="weekly-massas">
                <div class="form-row">
                    <label for="${weekOptionsId}">Semana:</label>
                    <select id="${weekOptionsId}"><option value="">Selecione a Semana</option></select>
                </div>
                <div class="form-row">
                    <label>Massas G (semana)</label>
                    <input type="number" id="quota-g" min="0" value="0">
                </div>
                <div class="form-row">
                    <label>Massas P (semana)</label>
                    <input type="number" id="quota-p" min="0" value="0">
                </div>
                <div class="form-row">
                    <label>Massas P Chocolate (semana)</label>
                    <input type="number" id="quota-pc" min="0" value="0">
                </div>
                <div class="form-row">
                    <button id="btn-salvar-quotas">Salvar</button>
                </div>
                <div id="quota-usage" class="small-muted"></div>
            </div>
        `;

    const sel = document.getElementById(weekOptionsId);
    populateWeekSelector(sel);

    sel.addEventListener("change", () => {
      loadQuotasIntoForm(sel.value);
      renderQuotaUsage(sel.value);
    });

    const thisWeek = getWeekStart();
    sel.value = thisWeek;
    loadQuotasIntoForm(thisWeek);
    renderQuotaUsage(thisWeek);

    document
      .getElementById("btn-salvar-quotas")
      .addEventListener("click", async () => {
        const semana_inicio = sel.value;
        const g_semana =
          parseInt(document.getElementById("quota-g").value) || 0;
        const p_semana =
          parseInt(document.getElementById("quota-p").value) || 0;
        const pc_semana =
          parseInt(document.getElementById("quota-pc").value) || 0;
        showLoader();
        const { error } = await supabaseClient
          .from("massas_semanais")
          .upsert(
            { semana_inicio, g_semana, p_semana, pc_semana },
            { onConflict: "semana_inicio" }
          );
        hideLoader();
        if (error) {
          showSaveStatus(
            "Erro ao salvar quotas semanais: " + error.message,
            false
          );
        } else {
          showSaveStatus("Quotas semanais salvas!");
          await loadDataFromSupabase();
          renderQuotaUsage(semana_inicio);
        }
      });
  };

  const loadQuotasIntoForm = (weekStart) => {
    const q = database.massas_semanais.find(
      (m) => m.semana_inicio === weekStart
    );
    document.getElementById("quota-g").value = q ? q.g_semana || 0 : 0;
    document.getElementById("quota-p").value = q ? q.p_semana || 0 : 0;
    document.getElementById("quota-pc").value = q ? q.pc_semana || 0 : 0;
  };

  const mapPizzaToDough = (pizza) => {
    if (!pizza) return null;
    if (pizza.tamanho === "G") return "G";
    if (pizza.tamanho === "P") {
      if (
        /(chocolate|choc|brigade|doce|nutella|prest[ií]gio|mm|morango|banana|amores)/i.test(
          pizza.nome
        )
      )
        return "PC";
      return "P";
    }
    return null;
  };

  const computeWeeklyUsage = (weekStart) => {
    const totals = { G: 0, P: 0, PC: 0 };
    database.pedidos.forEach((p) => {
      if (!p.dataEntrega) return;
      const ws = getWeekStart(p.dataEntrega);
      if (ws !== weekStart) return;
      (p.items || []).forEach((item) => {
        if (item.isCustom) return;
        const pizza = database.estoque.find((e) => e.id === item.pizzaId);
        const d = mapPizzaToDough(pizza);
        if (d) totals[d] += Number(item.qtd || 0);
      });
    });
    return totals;
  };

  const renderQuotaUsage = (weekStart) => {
    const el = document.getElementById("quota-usage");
    if (!el) return;
    const q = database.massas_semanais.find(
      (m) => m.semana_inicio === weekStart
    ) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
    const used = computeWeeklyUsage(weekStart);
    const remaining = {
      G: (q.g_semana || 0) - used.G,
      P: (q.p_semana || 0) - used.P,
      PC: (q.pc_semana || 0) - used.PC,
    };
    el.innerHTML = `
            <b>Uso da Semana:</b><br>
            G: ${used.G}/${q.g_semana || 0} (restante ${remaining.G})<br>
            P: ${used.P}/${q.p_semana || 0} (restante ${remaining.P})<br>
            P de Chocolate: ${used.PC}/${q.pc_semana || 0} (restante ${remaining.PC
      })
        `;
  };

  const renderProductionDemand = () => {
    const tbody = document
      .getElementById("tabela-demanda-producao")
      ?.querySelector("tbody");
    if (!tbody) return;

    const sizeFilter = document.getElementById("filter-demanda-tamanho").value;
    const weekFilterSelect = document.getElementById("filter-demanda-semana");
    const selectedWeek = weekFilterSelect.value || getWeekStart();

    if (!weekFilterSelect.value && weekFilterSelect.options.length > 1) {
      weekFilterSelect.value = selectedWeek;
    }

    const demandMap = new Map();
    database.pedidos
      .filter(p => p.status === "Pendente" && getWeekStart(p.dataEntrega) === selectedWeek)
      .forEach(p => {
        p.items.forEach(item => {
          if (!item.isCustom && item.pizzaId) {
            const currentDemand = demandMap.get(item.pizzaId) || 0;
            demandMap.set(item.pizzaId, currentDemand + item.qtd);
          }
        });
      });

    let productionData = database.estoque
      .filter(pizza => {
        return !sizeFilter || pizza.tamanho === sizeFilter;
      })
      .map(pizza => {
        const quantidadePedidos = demandMap.get(pizza.id) || 0;
        const estoqueAtual = pizza.qtd;
        const sobraProjetada = estoqueAtual - quantidadePedidos;

        return {
          sabor: `${pizza.nome} (${pizza.tamanho})`,
          quantidade: quantidadePedidos,
          estoqueAtual: estoqueAtual,
          sobraProjetada: sobraProjetada
        };
      })
      .filter(data => {
        return data.quantidade > 0 || data.sobraProjetada > 0;
      });

    const { column, direction } = sortState.demanda;
    productionData.sort((a, b) => {
      const valA = a[column];
      const valB = b[column];
      if (typeof valA === "number") return valA - valB;
      return (valA || "").localeCompare(valB || "");
    });
    if (direction === "desc") productionData.reverse();

    tbody.innerHTML = "";
    if (productionData.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align: center;">Nenhuma pizza com pedidos ou sobras para a semana selecionada.</td></tr>';
      return;
    }

    productionData.forEach((data) => {
      const row = tbody.insertRow();
      const surplusClass = data.sobraProjetada < 0 ? "low-stock" : "";
      row.innerHTML = `
          <td data-label="Sabor da Pizza">${data.sabor}</td>
          <td data-label="Pedidos (Pendentes)">${data.quantidade}x</td>
          <td data-label="Estoque Atual">${data.estoqueAtual}</td>
          <td data-label="Sobra Projetada" class="${surplusClass}"><b>${data.sobraProjetada}</b></td>
      `;
    });
    updateSortHeaders("tabela-demanda-producao", column, direction);
  };

  document.getElementById("pedido-cliente")?.addEventListener("input", (e) => {
    const nome = e.target.value;
    const cliente = database.clientes.find(
      (c) => c.nome.toLowerCase() === nome.toLowerCase()
    );
    if (cliente) {
      document.getElementById("pedido-cliente-telefone").value =
        cliente.telefone || "";
      document.getElementById("pedido-cidade").value = cliente.cidade || "";
    }
  });

  document
    .getElementById("filter-demanda-tamanho")
    ?.addEventListener("input", renderProductionDemand);

  document
    .getElementById("filter-demanda-semana")
    ?.addEventListener("change", renderProductionDemand);

  const handleSort = (tableKey, column) => {
    const state = sortState[tableKey];
    if (state.column === column) {
      state.direction = state.direction === "asc" ? "desc" : "asc";
    } else {
      state.column = column;
      state.direction = "asc";
    }

    const renderFunction = {
      pedidos: renderPedidos,
      clientes: renderClientes,
      estoque: renderEstoque,
      ingredientes: renderIngredientes,
      demanda: renderProductionDemand,
      sobras: renderConsultaRapidaSobras,
    }[tableKey];

    if (renderFunction) renderFunction();
  };

  const updateSortHeaders = (tableId, column, direction) => {
    const table = document.getElementById(tableId);
    if (!table) return;

    table.querySelectorAll("thead th[data-sort-by]").forEach((th) => {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.sortBy === column) {
        th.classList.add(direction === "asc" ? "sort-asc" : "sort-desc");
      }
    });
  };

  [
    "tabela-estoque",
    "tabela-ingredientes",
    "tabela-clientes",
    "tabela-pedidos",
    "tabela-demanda-producao",
    "tabela-sobras-pizzas",
  ].forEach((id) => {
    const table = document.getElementById(id);
    if (table) {
      table.querySelector("thead")?.addEventListener("click", (e) => {
        const header = e.target.closest("th");
        if (header && header.dataset.sortBy) {
          const tableKey = id.includes("sobras")
            ? "sobras"
            : id.replace("tabela-", "").replace("-producao", "");
          handleSort(tableKey, header.dataset.sortBy);
        }
      });
    }
  });

  const renderIngredientes = () => {
    const tbody = document
      .getElementById("tabela-ingredientes")
      ?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document
      .getElementById("search-ingredientes")
      .value.toLowerCase();
    let filteredData = database.ingredientes.filter((item) =>
      (item.nome || "").toLowerCase().includes(searchTerm)
    );

    const { column, direction } = sortState.ingredientes;
    filteredData.sort((a, b) => {
      const valA = a[column] ?? "";
      const valB = b[column] ?? "";
      if (typeof valA === "number") return valA - valB;
      return valA.localeCompare(valB);
    });
    if (direction === "desc") filteredData.reverse();

    tbody.innerHTML = "";
    filteredData.forEach((item) => {
      const row = tbody.insertRow();
      if (item.qtd < item.estoqueMinimo) row.classList.add("low-stock");
      row.innerHTML = `<td data-label="Nome">${item.nome
        }</td><td data-label="Qtd. em Estoque">${(item.qtd || 0).toFixed(
          3
        )}</td><td data-label="Estoque Mínimo">${(
          item.estoqueMinimo || 0
        ).toFixed(
          3
        )}</td><td data-label="Custo (p/ Unidade)" class="admin-only">${formatCurrency(
          item.custo
        )}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editIngrediente('${item.id
        }')">Editar</button><button class="action-btn remove-btn" onclick="window.removeIngrediente('${item.id
        }')">Remover</button></td>`;
    });
    updateSortHeaders("tabela-ingredientes", column, direction);
  };

  document
    .getElementById("form-ingrediente")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      showLoader();
      const id = document.getElementById("ingrediente-id").value;
      const newIngrediente = {
        nome: document.getElementById("ingrediente-nome").value,
        qtd: parseFloat(document.getElementById("ingrediente-qtd").value) || 0,
        custo:
          parseFloat(document.getElementById("ingrediente-custo").value) || 0,
        estoqueMinimo:
          parseFloat(
            document.getElementById("ingrediente-estoque-minimo").value
          ) || 0,
      };

      let error;
      if (id) {
        ({ error } = await supabaseClient
          .from("ingredientes")
          .update(newIngrediente)
          .eq("id", id));
      } else {
        ({ error } = await supabaseClient
          .from("ingredientes")
          .insert(newIngrediente));
      }
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao salvar ingrediente: " + error.message, false);
      } else {
        showSaveStatus("Ingrediente salvo!");
        e.target.reset();
        document.getElementById("ingrediente-id").value = "";
        await loadDataFromSupabase();
      }
    });

  window.editIngrediente = (id) => {
    const item = database.ingredientes.find((i) => i.id === id);
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

    openModal("edit-modal", "Editar Ingrediente", formHTML, () => {
      document.getElementById("edit-ingrediente-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const updatedData = {
          nome: formData.get("nome"),
          qtd: parseFloat(formData.get("qtd")),
          custo: parseFloat(formData.get("custo")),
          estoqueMinimo: parseFloat(formData.get("estoqueMinimo")),
        };
        showLoader();
        const { error } = await supabaseClient
          .from("ingredientes")
          .update(updatedData)
          .eq("id", id);
        hideLoader();
        if (error) {
          showSaveStatus("Erro ao atualizar: " + error.message, false);
        } else {
          showSaveStatus("Ingrediente salvo!");
          await loadDataFromSupabase();
          closeModal("edit-modal");
        }
      };
    });
  };

  window.removeIngrediente = async (id) => {
    if (confirm("Remover este ingrediente?")) {
      showLoader();
      const { error } = await supabaseClient
        .from("ingredientes")
        .delete()
        .eq("id", id);
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao remover: " + error.message, false);
      } else {
        await loadDataFromSupabase();
      }
    }
  };

  document
    .getElementById("search-ingredientes")
    ?.addEventListener("input", renderIngredientes);

  const renderEstoque = () => {
    const tbody = document
      .getElementById("tabela-estoque")
      ?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document
      .getElementById("search-estoque")
      .value.toLowerCase();
    let filteredData = database.estoque.filter((item) =>
      (item.nome || "").toLowerCase().includes(searchTerm)
    );

    const { column, direction } = sortState.estoque;
    filteredData.sort((a, b) => {
      let valA, valB;
      if (column === "custo" || column === "lucro") {
        const custoA = calculatePizzaCost(a.id);
        const custoB = calculatePizzaCost(b.id);
        valA = column === "custo" ? custoA : a.precoVenda - custoA;
        valB = column === "custo" ? custoB : b.precoVenda - custoB;
      } else {
        valA = a[column] ?? "";
        valB = b[column] ?? "";
      }

      if (typeof valA === "number") return valA - valB;
      return (valA || "").localeCompare(valB || "");
    });
    if (direction === "desc") filteredData.reverse();

    tbody.innerHTML = "";
    filteredData.forEach((item) => {
      const custo = calculatePizzaCost(item.id);
      const lucro = item.precoVenda - custo;
      const row = tbody.insertRow();
      if (item.qtd <= 0) row.classList.add("low-stock");
      row.innerHTML = `<td data-label="Sabor da Pizza">${item.nome
        }</td><td data-label="Tamanho">${item.tamanho || "N/A"
        }</td><td data-label="Qtd.">${item.qtd
        }</td><td data-label="Custo Produção" class="admin-only">${formatCurrency(
          custo
        )}</td><td data-label="Preço Venda">${formatCurrency(
          item.precoVenda
        )}</td><td data-label="Lucro Bruto" class="admin-only" style="color:${lucro >= 0 ? "green" : "red"
        };font-weight:bold;">${formatCurrency(
          lucro
        )}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editEstoque('${item.id
        }')">Editar</button><button class="action-btn remove-btn" onclick="window.removeEstoque('${item.id
        }')">Remover</button></td>`;
    });
    updateSortHeaders("tabela-estoque", column, direction);
  };

  document
    .getElementById("form-estoque")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      showLoader();
      const id = document.getElementById("estoque-id").value;
      const pizzaData = {
        nome: document.getElementById("estoque-nome").value,
        tamanho: document.getElementById("estoque-tamanho").value,
        qtd: parseInt(document.getElementById("estoque-qtd").value) || 0,
        precoVenda:
          parseFloat(document.getElementById("estoque-preco-venda").value) ||
          0,
      };

      let error;
      if (id) {
        ({ error } = await supabaseClient
          .from("estoque")
          .update(pizzaData)
          .eq("id", id));
      } else {
        ({ error } = await supabaseClient.from("estoque").insert(pizzaData));
      }
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao salvar pizza: " + error.message, false);
      } else {
        showSaveStatus("Pizza salva!");
        e.target.reset();
        document.getElementById("estoque-id").value = "";
        await loadDataFromSupabase();
      }
    });

  window.editEstoque = (id) => {
    const item = database.estoque.find((p) => p.id === id);
    if (!item) return;

    const formHTML = `
            <form id="edit-estoque-form">
                <div class="form-group"><label>Sabor da Pizza</label><input type="text" name="nome" value="${item.nome
      }" required></div>
                <div class="form-group"><label>Tamanho</label>
                    <select name="tamanho" required>
                        <option value="P" ${item.tamanho === "P" ? "selected" : ""
      }>Pequena</option>
                        <option value="G" ${item.tamanho === "G" ? "selected" : ""
      }>Grande</option>
                    </select>
                </div>
                <div class="form-group"><label>Quantidade</label><input type="number" name="qtd" value="${item.qtd
      }" required></div>
                <div class="form-group"><label>Preço de Venda</label><input type="number" name="precoVenda" value="${item.precoVenda
      }" step="0.01" required></div>
                <button type="submit">Salvar</button>
            </form>
        `;

    openModal("edit-modal", "Editar Pizza", formHTML, () => {
      document.getElementById("edit-estoque-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const updatedData = {
          nome: formData.get("nome"),
          tamanho: formData.get("tamanho"),
          qtd: parseInt(formData.get("qtd")),
          precoVenda: parseFloat(formData.get("precoVenda")),
        };
        showLoader();
        const { error } = await supabaseClient
          .from("estoque")
          .update(updatedData)
          .eq("id", id);
        hideLoader();
        if (error) {
          showSaveStatus("Erro ao atualizar: " + error.message, false);
        } else {
          showSaveStatus("Pizza salva!");
          await loadDataFromSupabase();
          closeModal("edit-modal");
        }
      };
    });
  };

  window.removeEstoque = async (id) => {
    if (
      confirm("Remover esta pizza? Isso também removerá receitas associadas.")
    ) {
      showLoader();
      const { error } = await supabaseClient
        .from("estoque")
        .delete()
        .eq("id", id);
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao remover pizza: " + error.message, false);
      } else {
        await loadDataFromSupabase();
      }
    }
  };

  document
    .getElementById("search-estoque")
    ?.addEventListener("input", renderEstoque);

  const renderReceitaIngredientesList = () => {
    const container = document.getElementById("receita-ingredientes-list");
    if (!container) return;
    container.innerHTML = "";
    if (receitaAtualIngredientes) {
      receitaAtualIngredientes.forEach((item, index) => {
        const ingrediente = database.ingredientes.find(
          (i) => i.id === item.ingredienteId
        );
        container.innerHTML += `<div class="receita-ingrediente-item"><p><span>${(
          item.qtd || 0
        ).toFixed(3)} x</span> ${ingrediente ? ingrediente.nome : "Ingrediente removido"
          }</p><button type="button" class="btn-remove-item" onclick="window.removeIngredienteDaReceita(${index})">X</button></div>`;
      });
    }
  };

  const renderReceitas = () => {
    const tbody = document
      .getElementById("tabela-receitas")
      ?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document
      .getElementById("search-receitas")
      .value.toLowerCase();
    tbody.innerHTML = "";
    const filteredData = database.receitas.filter((receita) => {
      const pizza = database.estoque.find((p) => p.id === receita.pizzaId);
      if (!pizza) return false;
      const nomePizza = `${pizza.nome} (${pizza.tamanho || ""
        })`.toLowerCase();
      return nomePizza.includes(searchTerm);
    });

    filteredData.forEach((receita) => {
      const pizza = database.estoque.find((p) => p.id === receita.pizzaId);
      if (!pizza) return;
      const ingredientesList =
        receita.ingredientes
          ?.map((item) => {
            const ingrediente = database.ingredientes.find(
              (i) => i.id === item.ingredienteId
            );
            return ingrediente
              ? `${(item.qtd || 0).toFixed(3)} de ${ingrediente.nome}`
              : "item inválido";
          })
          .join(", ") || "Sem ingredientes";
      const custoTotal = calculatePizzaCost(pizza.id);
      const row = tbody.insertRow();
      row.innerHTML = `<td data-label="Pizza">${pizza.nome} (${pizza.tamanho || ""
        })</td><td data-label="Ingredientes"><small>${ingredientesList}</small></td><td data-label="Custo Total" class="admin-only">${formatCurrency(
          custoTotal
        )}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editReceita('${receita.pizzaId
        }')">Editar</button><button class="action-btn remove-btn" onclick="window.removeReceita('${receita.pizzaId
        }')">Remover</button></td>`;
    });
  };

  document
    .getElementById("receita-pizza-select")
    ?.addEventListener("change", (e) => {
      const pizzaId = e.target.value;
      const receitaExistente = database.receitas.find(
        (r) => r.pizzaId === pizzaId
      );
      receitaAtualIngredientes = receitaExistente
        ? [...(receitaExistente.ingredientes || [])]
        : [];
      renderReceitaIngredientesList();
    });

  document
    .getElementById("btn-add-ingrediente-receita")
    ?.addEventListener("click", () => {
      const ingredienteId = document.getElementById(
        "receita-ingrediente-select"
      ).value;
      const qtd = parseFloat(
        document.getElementById("receita-ingrediente-qtd").value
      );
      if (!ingredienteId || !qtd) {
        alert("Selecione um ingrediente e defina a quantidade.");
        return;
      }
      receitaAtualIngredientes.push({ ingredienteId, qtd });
      renderReceitaIngredientesList();
      document.getElementById("receita-ingrediente-select").value = "";
      document.getElementById("receita-ingrediente-qtd").value = "";
    });

  window.removeIngredienteDaReceita = (index) => {
    receitaAtualIngredientes.splice(index, 1);
    renderReceitaIngredientesList();
  };

  document
    .getElementById("btn-salvar-receita")
    ?.addEventListener("click", async () => {
      const pizzaId = document.getElementById("receita-pizza-select").value;
      if (!pizzaId) {
        alert("Selecione uma pizza para salvar a receita.");
        return;
      }
      showLoader();
      const receitaData = {
        pizzaId,
        ingredientes: [...receitaAtualIngredientes],
      };

      const { error } = await supabaseClient
        .from("receitas")
        .upsert(receitaData, { onConflict: "pizzaId" });
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao salvar receita: " + error.message, false);
      } else {
        showSaveStatus("Receita salva!");
        receitaAtualIngredientes = [];
        renderReceitaIngredientesList();
        document.getElementById("form-receita").reset();
        document.getElementById("receita-ingrediente-select").value = "";
        document.getElementById("receita-ingrediente-qtd").value = "";
        await loadDataFromSupabase();
      }
    });

  window.editReceita = (pizzaId) => {
    document.getElementById("receita-pizza-select").value = pizzaId;
    document
      .getElementById("receita-pizza-select")
      .dispatchEvent(new Event("change"));
    document.querySelector('[data-tab="receitas"]').scrollIntoView();
  };

  window.removeReceita = async (pizzaId) => {
    if (confirm("Tem certeza que deseja remover esta receita?")) {
      showLoader();
      const { error } = await supabaseClient
        .from("receitas")
        .delete()
        .eq("pizzaId", pizzaId);
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao remover receita: " + error.message, false);
      } else {
        await loadDataFromSupabase();
      }
    }
  };
  document
    .getElementById("search-receitas")
    ?.addEventListener("input", renderReceitas);

  const getFilteredPedidos = (filterRange = "all") => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(
      today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)
    );
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return database.pedidos.filter((p) => {
      if (p.status !== "Concluído") return false;
      const pDate = new Date(p.dataEntrega);
      switch (filterRange) {
        case "today":
          return pDate >= today;
        case "week":
          return pDate >= weekStart;
        case "month":
          return pDate >= monthStart;
        case "all":
        default:
          return true;
      }
    });
  };

  const renderDashboard = (filterRange = "all") => {
    Object.values(chartInstances).forEach((chart) => {
      if (chart && typeof chart.destroy === "function") chart.destroy();
    });
    const filteredPedidos = getFilteredPedidos(filterRange);
    if (!document.getElementById("balancoChart")) return;
    renderBalancoChart(filteredPedidos);
    renderPizzasMaisLucrativasChart(filteredPedidos);
    renderVendasPorVendedorChart(filteredPedidos);
    renderPizzasMaisVendidasChart(filteredPedidos);
    renderPedidosSemanaChart(filteredPedidos);
    renderVendasPorDiaChart(filteredPedidos);
  };

  const renderBalancoChart = (t) => {
    const e = t.reduce((t, e) => t + Number(e.valorFinal), 0),
      a = t.reduce((t, e) => {
        const a = e.items.reduce((t, a) => {
          if (a.isCustom) return t;
          const r = calculatePizzaCost(a.pizzaId);
          return t + r * a.qtd;
        }, 0);
        return t + a;
      }, 0),
      r = e - a;
    if (!document.getElementById("balancoChart")) return;
    const o = document.getElementById("balancoChart").getContext("2d");
    if (chartInstances.balanco) chartInstances.balanco.destroy();
    chartInstances.balanco = new Chart(o, {
      type: "bar",
      data: {
        labels: ["Balanço Financeiro"],
        datasets: [
          { label: "Receita Total", data: [e], backgroundColor: "#2ecc71" },
          { label: "Custo Total", data: [a], backgroundColor: "#e74c3c" },
          { label: "Lucro Total", data: [r], backgroundColor: "#3498db" },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: !0,
        scales: { x: { ticks: { callback: (t) => formatCurrency(t) } } },
      },
    });
  };
  const renderPizzasMaisLucrativasChart = (t) => {
    const e = t
      .flatMap((t) => t.items)
      .reduce((t, e) => {
        if (e.isCustom) return t;
        const a = calculatePizzaCost(e.pizzaId),
          r = (e.preco - a) * e.qtd;
        return (t[e.pizzaNome] = (t[e.pizzaNome] || 0) + r), t;
      }, {}),
      a = Object.keys(e)
        .sort((t, a) => e[a] - e[t])
        .slice(0, 10),
      r = a.map((t) => e[t]);
    if (!document.getElementById("pizzasMaisLucrativasChart")) return;
    const o = document
      .getElementById("pizzasMaisLucrativasChart")
      .getContext("2d");
    if (chartInstances.lucro) chartInstances.lucro.destroy();
    chartInstances.lucro = new Chart(o, {
      type: "doughnut",
      data: {
        labels: a,
        datasets: [
          {
            data: r,
            backgroundColor: [
              "#2ecc71",
              "#3498db",
              "#9b59b6",
              "#f1c40f",
              "#e67e22",
              "#1abc9c",
            ],
          },
        ],
      },
      options: {
        responsive: !0,
        plugins: {
          legend: { position: "top" },
          tooltip: {
            callbacks: { label: (t) => `${t.label}: ${formatCurrency(t.raw)}` },
          },
        },
      },
    });
  };
  const renderVendasPorVendedorChart = (t) => {
    const e = t.reduce((t, e) => {
      if (e.vendedor)
        t[e.vendedor] = (t[e.vendedor] || 0) + Number(e.valorFinal);
      return t;
    }, {}),
      a = Object.keys(e).sort((t, a) => e[a] - e[t]),
      r = a.map((t) => e[t]);
    if (!document.getElementById("vendasPorVendedorChart")) return;
    const o = document
      .getElementById("vendasPorVendedorChart")
      .getContext("2d");
    if (chartInstances.vendedor) chartInstances.vendedor.destroy();
    chartInstances.vendedor = new Chart(o, {
      type: "bar",
      data: {
        labels: a,
        datasets: [
          { label: "Total Vendido", data: r, backgroundColor: "#487eb0" },
        ],
      },
      options: {
        responsive: !0,
        scales: { y: { ticks: { callback: (t) => formatCurrency(t) } } },
      },
    });
  };
  const renderPizzasMaisVendidasChart = (t) => {
    const e = t
      .flatMap((t) => t.items)
      .reduce((t, e) => {
        return e.isCustom
          ? t
          : ((t[e.pizzaNome] = (t[e.pizzaNome] || 0) + e.qtd), t);
      }, {}),
      a = Object.keys(e)
        .sort((t, a) => e[a] - e[t])
        .slice(0, 10),
      r = a.map((t) => e[t]);
    if (!document.getElementById("pizzasMaisVendidasChart")) return;
    const o = document
      .getElementById("pizzasMaisVendidasChart")
      .getContext("2d");
    if (chartInstances.vendas) chartInstances.vendas.destroy();
    chartInstances.vendas = new Chart(o, {
      type: "pie",
      data: {
        labels: a,
        datasets: [
          {
            data: r,
            backgroundColor: [
              "#e74c3c",
              "#3498db",
              "#f1c40f",
              "#2ecc71",
              "#9b59b6",
              "#1abc9c",
            ],
          },
        ],
      },
      options: { responsive: !0, plugins: { legend: { position: "top" } } },
    });
  };

  const renderPedidosSemanaChart = (pedidos) => {
    const canvas = document.getElementById("pedidosSemanaChart");
    if (!canvas) return;
    const weeksMap = {};
    const todayWs = getWeekStart();
    const base = new Date(todayWs + "T00:00:00");
    for (let i = 7; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i * 7);
      const ws = getWeekStart(d.toISOString().slice(0, 10));
      weeksMap[ws] = 0;
    }
    pedidos.forEach((p) => {
      if (!p.dataEntrega) return;
      const ws = getWeekStart(p.dataEntrega);
      if (weeksMap.hasOwnProperty(ws)) {
        const qty = (p.items || []).reduce(
          (acc, it) => acc + Number(it.qtd || 0),
          0
        );
        weeksMap[ws] += qty;
      }
    });
    const labels = Object.keys(weeksMap)
      .sort()
      .map((ws) => {
        const d = new Date(ws + "T00:00:00");
        return d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
        });
      });
    const data = Object.values(weeksMap);
    const ctx = canvas.getContext("2d");
    if (chartInstances.semana) chartInstances.semana.destroy();
    chartInstances.semana = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Qtd de pizzas vendidas (semana)",
            data,
            tension: 0.3,
            fill: false,
            backgroundColor: "#1e272e",
            borderColor: "#e84118",
          },
        ],
      },
      options: { responsive: true, plugins: { legend: { display: true } } },
    });
  };

  const renderVendasPorDiaChart = (pedidos) => {
    const canvasElement = document.getElementById("vendasPorDiaChart");
    if (!canvasElement) return;
    const ctx = canvasElement.getContext("2d");
    const vendasPorDia = pedidos.reduce((acc, pedido) => {
      if (!pedido.dataEntrega) return acc;
      const dia = new Date(
        pedido.dataEntrega + "T00:00:00"
      ).toLocaleDateString("pt-BR");
      acc[dia] = (acc[dia] || 0) + Number(pedido.valorFinal);
      return acc;
    }, {});

    const labels = Object.keys(vendasPorDia).sort(
      (a, b) =>
        new Date(a.split("/").reverse().join("-")) -
        new Date(b.split("/").reverse().join("-"))
    );
    const data = labels.map((label) => vendasPorDia[label]);

    if (chartInstances.dia) chartInstances.dia.destroy();
    chartInstances.dia = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Receita por Dia",
            data: data,
            borderColor: "#2c3e50",
            tension: 0.1,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });
  };

  document.querySelectorAll(".date-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".date-filter")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
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
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
    XLSX.writeFile(
      workbook,
      `${filename}_${new Date()
        .toLocaleDateString("pt-BR")
        .replace(/\//g, "-")}.xlsx`
    );
  };

  document
    .getElementById("export-ingredientes")
    ?.addEventListener("click", () =>
      exportToExcel(database.ingredientes, "sasses_ingredientes")
    );
  document.getElementById("export-estoque")?.addEventListener("click", () => {
    const data = database.estoque.map((p) => ({
      Pizza: p.nome,
      Tamanho: p.tamanho,
      Quantidade: p.qtd,
      "Preco de Venda": p.precoVenda,
      "Custo de Produção": calculatePizzaCost(p.id),
      "Lucro por Unidade": p.precoVenda - calculatePizzaCost(p.id),
    }));
    exportToExcel(data, "sasses_estoque_financeiro");
  });
  document.getElementById("export-receitas")?.addEventListener("click", () => {
    const data = database.receitas.map((r) => {
      const pizza = database.estoque.find((p) => p.id === r.pizzaId);
      return {
        Pizza: pizza
          ? `${pizza.nome} (${pizza.tamanho || ""})`
          : "Pizza Removida",
        Ingredientes: r.ingredientes
          .map((i) => {
            const ingrediente = database.ingredientes.find(
              (ing) => ing.id === i.ingredienteId
            );
            return `${i.qtd} de ${ingrediente ? ingrediente.nome : "N/A"}`;
          })
          .join("; "),
        "Custo Total da Receita": calculatePizzaCost(r.pizzaId),
      };
    });
    exportToExcel(data, "sasses_receitas");
  });
  document.getElementById("export-pedidos")?.addEventListener("click", () => {
    const flatData = [];
    database.pedidos.forEach((p) => {
      if (p.items && p.items.length > 0) {
        p.items.forEach((item) => {
          flatData.push({
            "ID Pedido": p.id,
            Cliente: p.cliente,
            Telefone: p.telefone,
            Vendedor: p.vendedor,
            Cidade: p.cidade,
            "Semana Entrega": new Date(
              p.dataEntrega + "T00:00:00"
            ).toLocaleDateString("pt-BR"),
            Status: p.status,
            Pagamento: p.pagamento,
            "Item Pizza": item.pizzaNome,
            "Item Qtd": item.qtd,
            "Valor Final Pedido": p.valorFinal,
          });
        });
      }
    });
    exportToExcel(flatData, "sasses_pedidos_detalhado");
  });

  document
    .getElementById("btn-lista-compras")
    ?.addEventListener("click", () => {
      const itemsBaixos = database.ingredientes.filter(
        (i) => i.qtd < i.estoqueMinimo
      );
      let contentHTML =
        "<p>Ótima notícia! Nenhum ingrediente está com estoque baixo.</p>";

      if (itemsBaixos.length > 0) {
        contentHTML = `<table><thead><tr><th>Ingrediente</th><th>Estoque Atual</th><th>Estoque Mínimo</th><th>Comprar (sugestão)</th></tr></thead><tbody>`;
        itemsBaixos.forEach((item) => {
          const comprar = (item.estoqueMinimo - item.qtd).toFixed(3);
          contentHTML += `<tr><td>${item.nome}</td><td>${item.qtd.toFixed(
            3
          )}</td><td>${item.estoqueMinimo.toFixed(
            3
          )}</td><td><b>${comprar}</b></td></tr>`;
        });
        contentHTML += "</tbody></table>";
      }
      openModal(
        "modal-lista-compras",
        "Lista de Compras Sugerida",
        contentHTML
      );
    });

  document.getElementById("btn-print-lista")?.addEventListener("click", () => {
    const modalContent = document.getElementById(
      "modal-lista-compras"
    ).innerHTML;
    const printWindow = window.open("", "", "height=600,width=800");
    printWindow.document.write("<html><head><title>Lista de Compras</title>");
    printWindow.document.write('<link rel="stylesheet" href="style.css">');
    printWindow.document.write("</head><body>");
    printWindow.document.write(modalContent);
    printWindow.document.write("</body></html>");
    printWindow.document.close();
    printWindow.print();
  });

  document
    .getElementById("form-producao")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pizzaId = document.getElementById("producao-pizza-select").value;
      const quantidade = parseInt(
        document.getElementById("producao-qtd").value
      );

      if (!pizzaId || !quantidade || quantidade <= 0) {
        alert(
          "Por favor, selecione uma pizza e informe uma quantidade válida."
        );
        return;
      }

      const pizza = database.estoque.find((p) => p.id === pizzaId);
      if (
        !confirm(
          `Confirma a produção de ${quantidade}x ${pizza.nome}? \n(Esta ação apenas adicionará ao estoque, sem baixa de ingredientes).`
        )
      ) {
        return;
      }

      showLoader();

      try {
        const pizzaEstoque = database.estoque.find((p) => p.id === pizzaId);
        if (!pizzaEstoque) {
          throw new Error("Pizza não encontrada no banco de dados de estoque.");
        }

        const novaQuantidade = pizzaEstoque.qtd + quantidade;

        const { error } = await supabaseClient
          .from("estoque")
          .update({ qtd: novaQuantidade })
          .eq("id", pizzaId);

        if (error) {
          throw error;
        }

        showSaveStatus("Produção registrada e estoque atualizado!");
        await loadDataFromSupabase();
        e.target.reset();
      } catch (error) {
        showSaveStatus(`Erro ao registrar produção: ${error.message}`, false);
      } finally {
        hideLoader();
      }
    });

  document.getElementById("export-demanda")?.addEventListener("click", () => {
    const demand = {};
    database.pedidos
      .filter((p) => p.status === "Pendente")
      .forEach((p) => {
        p.items.forEach((item) => {
          demand[item.pizzaNome] = (demand[item.pizzaNome] || 0) + item.qtd;
        });
      });

    const dataForExcel = Object.entries(demand).map(([Sabor, Quantidade]) => ({
      Sabor,
      Quantidade,
    }));
    exportToExcel(dataForExcel, "demanda_de_producao");
  });

  window.openEditPedidoModal = (id) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    if (!pedido) return;

    pedidoEditItems = JSON.parse(JSON.stringify(pedido.items));

    const pizzaOptions = database.estoque
      .map((p) => {
        const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
        const stockStyle = p.qtd <= 0 ? "color:red;" : "";
        return `<option value="${p.id}" style="${stockStyle}">${label} (Estoque: ${p.qtd})</option>`;
      })
      .join("");

    const formHTML = `
            <form id="edit-pedido-form" class="form-vertical">
                <input type="hidden" name="id" value="${pedido.id}">
                <div class="form-group"><label>Cliente</label><input type="text" name="cliente" value="${pedido.cliente
      }" required></div>
                <div class="form-group"><label>Telefone</label><input type="text" name="telefone" value="${pedido.telefone || ""
      }"></div>
                <div class="form-group"><label>Cidade</label><input type="text" name="cidade" value="${pedido.cidade
      }" required></div>
                <div class="form-group"><label>Vendedor</label><input type="text" name="vendedor" value="${pedido.vendedor
      }" required></div>
                <div class="form-group">
                    <label>Pagamento</label>
                    <select name="pagamento" required>
                        <option value="Dinheiro" ${pedido.pagamento === "Dinheiro" ? "selected" : ""
      }>Dinheiro</option>
                        <option value="Cartão de Crédito" ${pedido.pagamento === "Cartão de Crédito"
        ? "selected"
        : ""
      }>Cartão de Crédito</option>
                        <option value="Cartão de Débito" ${pedido.pagamento === "Cartão de Débito"
        ? "selected"
        : ""
      }>Cartão de Débito</option>
                        <option value="Pix" ${pedido.pagamento === "Pix" ? "selected" : ""
      }>Pix</option>
                    </select>
                </div>
                 <div class="form-group">
                    <label>Status</label>
                    <select name="status" required>
                        <option value="Pendente" ${pedido.status === "Pendente" ? "selected" : ""
      }>Pendente</option>
                        <option value="Pronto" ${pedido.status === "Pronto" ? "selected" : ""
      }>Pronto</option>
                        <option value="Concluído" ${pedido.status === "Concluído" ? "selected" : ""
      }>Concluído</option>
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
                    <input type="number" id="valor-final-edit-pedido" placeholder="Valor Final" step="0.01" value="${pedido.valorFinal || ""
      }">
                </div>
                <button type="submit">Salvar Alterações</button>
            </form>
        `;

    openModal(
      "edit-modal",
      `Editar Pedido de ${pedido.cliente}`,
      formHTML,
      () => {
        renderEditPedidoCarrinho();
        updateTotalEditPedido();

        document
          .getElementById("btn-add-item-edit-pedido")
          .addEventListener("click", () => {
            const pizzaSelect = document.getElementById("edit-item-pizza");
            const pizzaId = pizzaSelect.value;
            const qtd = parseInt(
              document.getElementById("edit-item-qtd").value
            );
            if (!pizzaId || !qtd || qtd < 1) return;

            const pizzaData = database.estoque.find((p) => p.id === pizzaId);
            pedidoEditItems.push({
              pizzaId,
              pizzaNome: pizzaData.tamanho
                ? `${pizzaData.nome} (${pizzaData.tamanho})`
                : pizzaData.nome,
              qtd,
              isCustom: false,
              preco: pizzaData.precoVenda,
            });

            renderEditPedidoCarrinho();
            updateTotalEditPedido();

            pizzaSelect.value = "";
            document.getElementById("edit-item-qtd").value = "1";
          });

        document.getElementById("edit-pedido-form").onsubmit = async (e) => {
          e.preventDefault();
          await handleUpdatePedido(pedido);
        };
      }
    );
  };

  const renderEditPedidoCarrinho = () => {
    const container = document.getElementById("edit-pedido-itens-carrinho");
    container.innerHTML =
      '<p style="text-align:center;color:#777">Nenhuma pizza adicionada.</p>';
    if (pedidoEditItems.length > 0) {
      container.innerHTML = "";
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
    const total = pedidoEditItems.reduce(
      (acc, item) => acc + item.preco * item.qtd,
      0
    );
    document.getElementById("total-calculado-edit-pedido").textContent =
      formatCurrency(total);
    const valorFinalInput = document.getElementById("valor-final-edit-pedido");
    if (!valorFinalInput.value) {
      valorFinalInput.value = total.toFixed(2);
    }
  };

  const handleUpdatePedido = async (originalPedido) => {
    if (!confirm("Tem certeza que deseja salvar as alterações?")) return;
    showLoader();

    const form = document.getElementById("edit-pedido-form");
    const formData = new FormData(form);
    const valorFinalInput = form.querySelector(
      "#valor-final-edit-pedido"
    ).value;
    const valorCalculado = pedidoEditItems.reduce(
      (acc, item) => acc + item.preco * item.qtd,
      0
    );
    const valorFinal =
      parseFloat(valorFinalInput.replace(",", ".")) || valorCalculado;

    const updatedPedidoData = {
      cliente: formData.get("cliente"),
      telefone: formData.get("telefone"),
      cidade: formData.get("cidade"),
      vendedor: formData.get("vendedor"),
      pagamento: formData.get("pagamento"),
      status: formData.get("status"),
      items: pedidoEditItems,
      valorTotal: valorCalculado,
      valorFinal: valorFinal,
    };

    const semanaInicio = getWeekStart(originalPedido.dataEntrega);
    const quotas = database.massas_semanais.find(
      (m) => m.semana_inicio === semanaInicio
    ) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
    const used = computeWeeklyUsage(semanaInicio);

    originalPedido.items.forEach((item) => {
      if (item.isCustom) return;
      const pizza = database.estoque.find((e) => e.id === item.pizzaId);
      const doughType = mapPizzaToDough(pizza);
      if (doughType) {
        used[doughType] -= Number(item.qtd || 0);
      }
    });

    const newOrderDoughs = { G: 0, P: 0, PC: 0 };
    updatedPedidoData.items.forEach((item) => {
      if (item.isCustom) return;
      const pizza = database.estoque.find((e) => e.id === item.pizzaId);
      const doughType = mapPizzaToDough(pizza);
      if (doughType) {
        newOrderDoughs[doughType] += Number(item.qtd || 0);
      }
    });

    const exceeds = [];
    if (used.G + newOrderDoughs.G > (quotas.g_semana || 0)) {
      exceeds.push(`G: ${used.G + newOrderDoughs.G}/${quotas.g_semana || 0}`);
    }
    if (used.P + newOrderDoughs.P > (quotas.p_semana || 0)) {
      exceeds.push(`P: ${used.P + newOrderDoughs.P}/${quotas.p_semana || 0}`);
    }
    if (used.PC + newOrderDoughs.PC > (quotas.pc_semana || 0)) {
      exceeds.push(
        `P de Chocolate: ${used.PC + newOrderDoughs.PC}/${quotas.pc_semana || 0
        }`
      );
    }

    if (exceeds.length > 0) {
      hideLoader();
      alert(
        "Limite semanal de massas atingido para: " +
        exceeds.join(" | ") +
        ". Ajuste as quantidades."
      );
      return;
    }

    const originalStatus = originalPedido.status;
    const newStatus = updatedPedidoData.status;
    const stockUpdatePromises = [];

    const getItemsMap = (items) => {
        const map = new Map();
        (items || []).forEach(item => {
            if (!item.isCustom && item.pizzaId) {
                map.set(item.pizzaId, (map.get(item.pizzaId) || 0) + Number(item.qtd || 0));
            }
        });
        return map;
    };

    const originalItemsMap = getItemsMap(originalPedido.items);
    const newItemsMap = getItemsMap(updatedPedidoData.items);
    const allPizzaIds = new Set([...originalItemsMap.keys(), ...newItemsMap.keys()]);

    allPizzaIds.forEach(pizzaId => {
        const originalQtd = originalItemsMap.get(pizzaId) || 0;
        const newQtd = newItemsMap.get(pizzaId) || 0;
        const diff = newQtd - originalQtd; 

        const pizzaEstoque = database.estoque.find(p => p.id === pizzaId);
        if (!pizzaEstoque) return; 

        let stockAdjustment = 0;

        if (originalStatus !== 'Pronto' && newStatus === 'Pronto') {
            stockAdjustment = -newQtd;
        } else if (originalStatus === 'Pronto' && newStatus !== 'Pronto') {
            stockAdjustment = +originalQtd;
        } else if (originalStatus === 'Pronto' && newStatus === 'Pronto') {
            stockAdjustment = -diff; 
        }

        if (stockAdjustment !== 0) {
            const novaQtd = pizzaEstoque.qtd + stockAdjustment;
            stockUpdatePromises.push(
                supabaseClient
                    .from("estoque")
                    .update({ qtd: novaQtd })
                    .eq("id", pizzaId)
            );
        }
    });

    try {
        if (stockUpdatePromises.length > 0) {
            const results = await Promise.all(stockUpdatePromises);
            const stockErrors = results.map(r => r.error).filter(Boolean);
            if (stockErrors.length > 0) {
                throw new Error(
                    "Falha ao reconciliar o estoque: " +
                    stockErrors.map(e => e.message).join("\n")
                );
            }
            showSaveStatus("Estoque reconciliado!");
        }

        const { error: updateError } = await supabaseClient
            .from("pedidos")
            .update(updatedPedidoData)
            .eq("id", originalPedido.id);
        if (updateError) throw updateError;

        showSaveStatus("Pedido atualizado com sucesso!");
        closeModal("edit-modal");
        await loadDataFromSupabase();

    } catch (error) {
        console.error("Erro ao atualizar pedido:", error);
        showSaveStatus(`Erro ao atualizar pedido: ${error.message}`, false);
    } finally {
        hideLoader();
    }
  };

  const computePizzaDemandForWeek = (weekStart) => {
    const demand = {};
    database.pedidos
      .filter(p => {
        if (!p.dataEntrega) return false;
        const ws = getWeekStart(p.dataEntrega);
        return ws === weekStart && p.status === 'Pendente';
      })
      .forEach(p => {
        (p.items || []).forEach(item => {
          if (item.isCustom || !item.pizzaId) return;
          demand[item.pizzaId] = (demand[item.pizzaId] || 0) + Number(item.qtd || 0);
        });
      });
    return demand;
  };

  const renderConsultaRapidaSobras = () => {
    const selectSemana = document.getElementById("sobras-semana-select");
    const searchInput = document.getElementById("sobras-search-pizza");
    if (!selectSemana) return;

    if (!selectSemana.value) {
      populateWeekSelector(selectSemana);
      selectSemana.value = getWeekStart();
    }

    const refresh = () => {
      const weekStart = selectSemana.value || getWeekStart();
      const searchTerm = searchInput.value.toLowerCase();
      const quotas = database.massas_semanais.find(
        (m) => m.semana_inicio === weekStart
      ) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
      const used = computeWeeklyUsage(weekStart, true); 
      const tbodyM = document.querySelector("#tabela-sobras-massas tbody");
      if (tbodyM) {
        tbodyM.innerHTML = `
          <tr><td>G</td><td>${quotas.g_semana || 0
          }</td><td>${used.G}</td><td><b>${(quotas.g_semana || 0) - used.G
          }</b></td></tr>
          <tr><td>P</td><td>${quotas.p_semana || 0
          }</td><td>${used.P}</td><td><b>${(quotas.p_semana || 0) - used.P
          }</b></td></tr>
          <tr><td>P de Chocolate</td><td>${quotas.pc_semana || 0
          }</td><td>${used.PC}</td><td><b>${(quotas.pc_semana || 0) - used.PC
          }</b></td></tr>
        `;
      }

      const demandByPizza = computePizzaDemandForWeek(weekStart);

      let pizzaData = database.estoque.map((e) => {
        const pedidosSemana = demandByPizza[e.id] || 0;
        const sobraProj = (e.qtd || 0) - pedidosSemana;
        return { ...e, pedidosSemana, sobraProj };
      });

      if (searchTerm) {
        pizzaData = pizzaData.filter((p) =>
          p.nome.toLowerCase().includes(searchTerm)
        );
      }

      const { column, direction } = sortState.sobras;
      pizzaData.sort((a, b) => {
        const valA = a[column];
        const valB = b[column];
        if (typeof valA === "number") {
          return direction === "asc" ? valA - valB : valB - valA;
        }
        return direction === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });

      const tbodyP = document.querySelector("#tabela-sobras-pizzas tbody");
      if (tbodyP) {
        tbodyP.innerHTML = "";
        pizzaData.forEach((e) => {
          const tr = document.createElement("tr");
          if (e.sobraProj < 0) {
            tr.classList.add("low-stock");
          }
          tr.innerHTML = `
              <td data-label="Pizza">${e.nome} (${e.tamanho})</td>
              <td data-label="Em estoque">${e.qtd ?? 0}</td>
              <td data-label="Pedidos (semana)">${e.pedidosSemana}</td>
              <td data-label="Sobra projetada"><b>${e.sobraProj}</b></td>`;
          tbodyP.appendChild(tr);
        });
        updateSortHeaders("tabela-sobras-pizzas", column, direction);
      }
    };

    selectSemana.removeEventListener("change", refresh);
    searchInput.removeEventListener("input", refresh);
    selectSemana.addEventListener("change", refresh);
    searchInput.addEventListener("input", refresh);

    refresh();
  };

  document.getElementById("btn-open-filter-modal")?.addEventListener("click", () => {
      const vendedorSelect = document.getElementById("filter-modal-vendedor");
      if (vendedorSelect) {
          const currentVal = vendedorSelect.value;
          const firstOption = vendedorSelect.options[0];
          vendedorSelect.innerHTML = "";
          if (firstOption) vendedorSelect.appendChild(firstOption);
          
          const allFirstNames = database.pedidos.map(p => p.vendedor).filter(Boolean).map(vendedor => {
              const firstName = vendedor.trim().split(" ")[0];
              return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
          });
          const vendedores = [...new Set(allFirstNames)];
          vendedores.sort().forEach(v => {
              vendedorSelect.innerHTML += `<option value="${v}">${v}</option>`;
          });
          vendedorSelect.value = currentVal;
      }

      const semanaSelect = document.getElementById("filter-modal-semana");
      if (semanaSelect) {
          const currentVal = semanaSelect.value; 
          populateWeekSelector(semanaSelect); 
          
          const semanasPassadas = [...new Set(database.pedidos
              .filter(p => p.dataEntrega)
              .map(p => getWeekStart(p.dataEntrega))
          )].sort().reverse();
          
          semanasPassadas.forEach(semana => {
              if (!Array.from(semanaSelect.options).some(opt => opt.value === semana)) {
                   const d = new Date(semana + "T00:00:00");
                   const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
                   semanaSelect.innerHTML += `<option value="${semana}">Semana de ${label}</option>`;
              }
          });
          
          semanaSelect.value = currentVal;
      }
      
      openModal('filter-modal', 'Filtrar Pedidos'); 
  });

  document.getElementById("filter-pedidos-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      renderPedidos();
      closeModal('filter-modal');
  });

  document.getElementById("btn-clear-filters")?.addEventListener("click", () => {
      document.getElementById("filter-pedidos-form").reset();
      renderPedidos();
  });

  document
      .getElementById("search-pedidos")
      ?.addEventListener("input", renderPedidos);


  loadDataFromSupabase();
});