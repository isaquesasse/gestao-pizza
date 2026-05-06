document.addEventListener("DOMContentLoaded", () => {
  window.SASSES_VERSION = "v51-filtro-pedidos-corrigido";
  console.log("Sasse's Pizza", window.SASSES_VERSION);
  const SUPABASE_URL = "https://iprnfzevdfmnraexthpy.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlwcm5memV2ZGZtbnJhZXh0aHB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2NTE1NTAsImV4cCI6MjA2NzIyNzU1MH0.h5Omsd0XsRtAmOErRCpaqg91OkF53lB8WE9dYlVdRbo";
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const LOADER = document.getElementById("loader");
  const SAVE_STATUS = document.getElementById("save-status");
  const MINHA_CASA = { lat: -26.588820609074077, lon: -48.99248396751655 };
  const VALOR_POR_KM = 1.00;
  const ADMIN_PASSWORD = "sasse";
  const SELLER_PROFILE_KEY = "sassesCurrentSellerProfileId";

  if (localStorage.getItem("isAdminLoggedIn") === "true") {
    document.body.classList.add("admin-mode");
    const adminBtn = document.getElementById("btn-admin-view");
    if (adminBtn) adminBtn.textContent = "Sair da Visão ADM";
  }

  let database = {
    ingredientes: [],
    receitas: [],
    estoque: [],
    pedidos: [],
    clientes: [],
    massas: [],
    massas_semanais: [],
    caixa_movimentos: [],
    vendedores: [],
    loja_entrega_calendario: [],
    loja_entrega_recorrencia: [],
    loja_cupons: [],
  };

  const STOCK_ACTIVE_STATUSES = ["Pendente", "Confirmado", "Pronto", "Concluído"];
  const STOCK_RELEASED_STATUSES = ["Cancelado", "Negado"];
  const ALL_ORDER_STATUSES = [...STOCK_ACTIVE_STATUSES, ...STOCK_RELEASED_STATUSES];
  const orderHoldsStock = (status) => STOCK_ACTIVE_STATUSES.includes(status || "Pendente");

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
  let quickSaleItems = {};
  let receitaAtualIngredientes = [];
  let saveStatusTimeout;
  const chartInstances = {};
  let lojaCalendarMonth = new Date();
  lojaCalendarMonth.setDate(1);
  const lojaCalendarSelectedDates = new Set();
  const lojaCalendarSelectedWeekdays = new Set();
  let lojaCalendarMode = "datas";
  const LOJA_WEEKDAYS = [
    { value: 0, short: "Dom", label: "Domingo" },
    { value: 1, short: "Seg", label: "Segunda" },
    { value: 2, short: "Ter", label: "Terça" },
    { value: 3, short: "Qua", label: "Quarta" },
    { value: 4, short: "Qui", label: "Quinta" },
    { value: 5, short: "Sex", label: "Sexta" },
    { value: 6, short: "Sáb", label: "Sábado" },
  ];

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

  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[char]));

  const escapeAttr = (value) => escapeHTML(value);

  const safeNumber = (value, fallback = 0) => {
    const parsed = parseFloat(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const normalizeStatusClass = (status) =>
    (status || "pendente")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-");

  const getNumberValue = (value, fallback = 0) => {
    const parsed = parseFloat(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const parsePercent = (value) => {
    const raw = String(value ?? "").replace("%", "").replace(",", ".").trim();
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
  };

  const formatPercentField = (input) => {
    if (!input) return;
    const percent = parsePercent(input.value);
    input.value = percent > 0 ? `${String(percent).replace(".", ",")}%` : "";
  };

  const applyDiscount = (value, percent) => {
    const base = Number(value || 0);
    const pct = parsePercent(percent);
    return Math.max(0, base * (1 - pct / 100));
  };

  const getPedidoDiscountPercent = () => parsePercent(document.getElementById("pedido-desconto")?.value);
  const getQuickDiscountPercent = () => parsePercent(document.getElementById("quick-desconto")?.value);

  const getPrecoPorPagamento = (preco, pagamento) => {
    const valor = Number(preco || 0);
    if (pagamento === "Dinheiro") {
      if (Math.abs(valor - 38) < 0.01) return 35;
      if (Math.abs(valor - 28) < 0.01) return 25;
    }
    return valor;
  };

  const getPedidoPagamentoAtual = () => document.getElementById("pedido-pagamento")?.value || "";

  const isPedidoPago = (pedido) => pedido?.pago === true || pedido?.status === "Concluído";
  const isPedidoAtivoFinanceiro = (pedido) => !STOCK_RELEASED_STATUSES.includes(pedido?.status);

  const formatSupabaseError = (error, fallback = "Não foi possível salvar") => {
    const message = error?.message || String(error || fallback);
    console.error('[Sasses Gestão]', error);
    if (/row-level security|RLS|permission denied|not allowed/i.test(message)) return `${fallback}: acesso bloqueado.`;
    if (/schema cache|function .* does not exist|Could not find|column .* does not exist|relation .* does not exist/i.test(message)) return `${fallback}: atualização pendente no banco.`;
    if (/duplicate key|unique constraint/i.test(message)) return `${fallback}: já existe um cadastro igual.`;
    return `${fallback}: ${message}`;
  };

  const getStockMapFromItems = (items) => {
    const map = new Map();
    (items || []).forEach((item) => {
      if (item?.isCustom || !item?.pizzaId || item.pizzaId === "outro") return;
      map.set(item.pizzaId, (map.get(item.pizzaId) || 0) + Number(item.qtd || 0));
    });
    return map;
  };

  const getStockValidationError = (items, options = {}) => {
    const requested = getStockMapFromItems(items);
    const releasedMap = options.releaseMap || new Map();
    for (const [pizzaId, qtd] of requested.entries()) {
      const pizza = database.estoque.find((p) => p.id === pizzaId);
      if (!pizza) return `Pizza não encontrada no estoque: ${pizzaId}.`;
      const available = Number(pizza.qtd || 0) + Number(releasedMap.get(pizzaId) || 0);
      if (qtd > available) {
        const label = pizza.tamanho ? `${pizza.nome} (${pizza.tamanho})` : pizza.nome;
        return `Estoque insuficiente para ${label}. Disponível: ${available}, pedido: ${qtd}.`;
      }
    }
    return "";
  };

  const getAvailableStockForPizza = (pizzaId, items = [], releaseMap = new Map()) => {
    const pizza = database.estoque.find((p) => p.id === pizzaId);
    if (!pizza) return 0;
    const alreadyInCart = getStockMapFromItems(items).get(pizzaId) || 0;
    return Number(pizza.qtd || 0) + Number(releaseMap.get(pizzaId) || 0) - alreadyInCart;
  };

  const getClientHasUnpaid = (cliente) => {
    if (!cliente) return false;
    return database.pedidos.some((p) => {
      const sameId = cliente.id && p.clienteId === cliente.id;
      const sameNameCity = (p.cliente || "").toLowerCase() === (cliente.nome || "").toLowerCase() &&
        (p.cidade || "").toLowerCase() === (cliente.cidade || "").toLowerCase();
      return (sameId || sameNameCity) && isPedidoAtivoFinanceiro(p) && !isPedidoPago(p);
    });
  };

  const getSystemAlerts = () => {
    const prontosParaConcluir = database.pedidos
      .filter((p) => p.status === "Pronto")
      .sort((a, b) => `${a.dataEntrega || ""} ${a.cliente || ""}`.localeCompare(`${b.dataEntrega || ""} ${b.cliente || ""}`));
    return { prontosParaConcluir, total: prontosParaConcluir.length };
  };

  const refreshNotificationBadge = () => {
    const btn = document.getElementById("btn-notificacoes");
    const badge = document.getElementById("notificacoes-badge");
    if (!btn || !badge) return;
    const alerts = getSystemAlerts();
    badge.textContent = alerts.total;
    btn.classList.toggle("has-alerts", alerts.total > 0);
    btn.title = alerts.total > 0 ? `${alerts.total} pedido(s) pronto(s) para concluir` : "Sem pendências";
  };

  const getCurrentSellerId = () => localStorage.getItem(SELLER_PROFILE_KEY) || "";
  const getCurrentSeller = () => database.vendedores.find((v) => v.id === getCurrentSellerId()) || null;
  const isSellerAdmin = (seller) => String(seller?.senha_admin || "").trim() === ADMIN_PASSWORD;

  const applySellerAccess = () => {
    const seller = getCurrentSeller();
    const manualAdmin = localStorage.getItem("isAdminLoggedIn") === "true";
    const profileAdmin = isSellerAdmin(seller);
    document.body.classList.toggle("vendor-mode", !!seller);
    document.body.classList.toggle("admin-mode", manualAdmin || profileAdmin);
    const adminBtn = document.getElementById("btn-admin-view");
    if (adminBtn) adminBtn.textContent = (manualAdmin || profileAdmin) ? "Sair da Visão ADM" : "Entrar na Visão ADM";
  };

  const applySellerProfileToForms = (force = false) => {
    const seller = getCurrentSeller();
    const nameEl = document.getElementById("current-seller-name");
    const profileBtn = document.getElementById("btn-profile");
    if (nameEl) nameEl.textContent = seller ? seller.nome : "Perfil";
    if (profileBtn) profileBtn.classList.toggle("has-profile", !!seller);
    if (!seller) {
      applySellerAccess();
      return;
    }
    ["pedido-vendedor", "quick-vendedor"].forEach((id) => {
      const input = document.getElementById(id);
      if (input && (force || !input.value || input.dataset.profileAutofilled === "true")) {
        input.value = seller.nome;
        input.dataset.profileAutofilled = "true";
      }
    });
    applySellerAccess();
  };

  const setCurrentSeller = (id) => {
    if (id) {
      localStorage.setItem(SELLER_PROFILE_KEY, id);
      const seller = database.vendedores.find((v) => v.id === id);
      if (!isSellerAdmin(seller)) localStorage.removeItem("isAdminLoggedIn");
    } else {
      localStorage.removeItem(SELLER_PROFILE_KEY);
    }
    applySellerProfileToForms(true);
    renderSellerProfileUI();
    renderAll();
  };

  const renderSellerProfileUI = () => {
    const select = document.getElementById("seller-profile-select");
    const clientSelect = document.getElementById("seller-cliente-link");
    const currentCard = document.getElementById("profile-current-card");
    const seller = getCurrentSeller();
    if (select) {
      const currentValue = select.value || getCurrentSellerId();
      select.innerHTML = '<option value="">Selecionar vendedor...</option>' + database.vendedores
        .filter((v) => v.ativo !== false)
        .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""))
        .map((v) => `<option value="${v.id}">${escapeHTML(v.nome)}${isSellerAdmin(v) ? " · ADM" : ""}</option>`).join("");
      select.value = currentValue;
    }
    if (clientSelect) {
      const currentValue = clientSelect.value;
      clientSelect.innerHTML = '<option value="">Não vincular</option>' + database.clientes
        .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""))
        .map((c) => `<option value="${c.id}">${escapeHTML(c.nome)}${c.cidade ? ` · ${escapeHTML(c.cidade)}` : ""}</option>`).join("");
      if (currentValue) clientSelect.value = currentValue;
    }
    if (currentCard) {
      currentCard.innerHTML = seller ? `
        <div class="profile-current-left"><span class="profile-avatar large">👤</span><div><b>${escapeHTML(seller.nome)}</b><small>${isSellerAdmin(seller) ? "Administrador" : "Vendedor"}${seller.telefone ? ` · ${escapeHTML(seller.telefone)}` : ""}</small></div></div>
        <span class="badge-inline ${isSellerAdmin(seller) ? "success" : ""}">${isSellerAdmin(seller) ? "ADM ativo" : "Perfil ativo"}</span>
      ` : `<div class="profile-current-left"><span class="profile-avatar large">👤</span><div><b>Nenhum perfil selecionado</b><small>Escolha ou crie um vendedor para preencher pedidos automaticamente.</small></div></div>`;
    }
    applySellerProfileToForms(false);
  };

  const openSellerProfileModal = () => {
    renderSellerProfileUI();
    const modal = document.getElementById("profile-modal");
    if (modal) modal.style.display = "block";
  };

  window.openNotificationsModal = () => {
    const { prontosParaConcluir, total } = getSystemAlerts();
    let contentHTML = `<div class="notification-list">`;
    if (total === 0) {
      contentHTML += `<p class="empty-state">Nenhum pedido pronto aguardando conclusão.</p>`;
    } else {
      contentHTML += `<h3>Prontos para concluir</h3>`;
      prontosParaConcluir.slice(0, 40).forEach((p) => {
        const valor = formatCurrency(p.valorFinal || p.valorTotal);
        const data = p.dataEntrega ? new Date(p.dataEntrega + "T00:00:00").toLocaleDateString("pt-BR") : "sem data";
        const action = isPedidoPago(p)
          ? `<button class="action-btn complete-btn" onclick="window.updatePedidoStatus('${p.id}', 'Concluído')">Concluir</button>`
          : `<button class="action-btn paid-btn complete-btn" onclick="window.marcarPedidoPago('${p.id}')">Pago</button>`;
        contentHTML += `<div class="notification-item ready-to-finish"><div><b>${escapeHTML(p.cliente || "Cliente")}</b><span>${valor} • ${data}</span></div><div class="notification-actions">${action}<button class="action-btn edit-btn" onclick="window.openEditPedidoModal('${p.id}')">Abrir</button></div></div>`;
      });
    }
    contentHTML += `</div>`;
    openModal("notifications-modal", "Prontos para concluir", contentHTML);
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


  const normalizeMetodoEntrega = (pedido) => (pedido?.metodo_entrega || "retirada").toLowerCase() === "entrega" ? "entrega" : "retirada";
  const getMetodoEntregaLabel = (pedido) => normalizeMetodoEntrega(pedido) === "entrega" ? "Entrega" : "Retirada";
  const getPedidoStatusMeta = (pedido) => {
    const status = pedido?.status || "Pendente";
    switch (status) {
      case "Pendente":
        return { title: "Pedido", label: "Aguardando confirmação", tone: "warning" };
      case "Confirmado":
        return { title: "Pedido", label: "Confirmado", tone: "info" };
      case "Pronto":
        return { title: "Pedido", label: "Pronto", tone: "success" };
      case "Concluído":
        return { title: "Pedido", label: "Concluído", tone: "success" };
      case "Negado":
        return { title: "Pedido", label: "Rejeitado", tone: "danger" };
      case "Cancelado":
        return { title: "Pedido", label: "Cancelado", tone: "muted" };
      default:
        return { title: "Pedido", label: status, tone: "muted" };
    }
  };
  const getEstoqueStatusMeta = (pedido) => {
    if (STOCK_RELEASED_STATUSES.includes(pedido?.status)) {
      return { title: "Estoque", label: "Sem reserva", tone: "muted" };
    }
    if (pedido?.estoque_baixado === false) {
      return { title: "Estoque", label: "A produzir", tone: "warning" };
    }
    return { title: "Estoque", label: "Reservado", tone: "success" };
  };
  const getAtendimentoStatusMeta = (pedido) => ({
    title: getMetodoEntregaLabel(pedido),
    label: formatPedidoAgenda(pedido),
    tone: normalizeMetodoEntrega(pedido) === "entrega" ? "info" : "muted",
  });
  const formatDateBR = (value) => {
    if (!value) return "-";
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split("-");
    if (!y || !m || !d) return raw;
    return `${d}/${m}/${y}`;
  };
  const formatHoraPreferencia = (value) => {
    const hora = value ? String(value).slice(0, 5) : "";
    return !hora || hora === "00:00" ? "-" : hora;
  };
  const formatPedidoAgenda = (pedido) => {
    const data = formatDateBR(pedido?.dataEntrega);
    const hora = formatHoraPreferencia(pedido?.horario_preferencia || pedido?.horarioPreferencia);
    return hora === "-" ? data : `${data} às ${hora}`;
  };
  const normalizeCidadeKey = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  const formatCalendarSlot = () => "Entrega cadastrada";
  const toRad = (value) => Number(value || 0) * Math.PI / 180;
  const distanceKm = (a, b) => {
    if (!Number.isFinite(Number(a?.lat)) || !Number.isFinite(Number(a?.lon)) || !Number.isFinite(Number(b?.lat)) || !Number.isFinite(Number(b?.lon))) return Infinity;
    const R = 6371;
    const dLat = toRad(Number(b.lat) - Number(a.lat));
    const dLon = toRad(Number(b.lon) - Number(a.lon));
    const lat1 = toRad(Number(a.lat));
    const lat2 = toRad(Number(b.lat));
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const pedidoHasCoords = (pedido) => Number.isFinite(Number(pedido?.latitude)) && Number.isFinite(Number(pedido?.longitude));
  const getPedidoCoords = (pedido) => ({ lat: Number(pedido.latitude), lon: Number(pedido.longitude) });
  const buildGoogleMapsRouteUrl = (orderedPedidos) => {
    if (!orderedPedidos.length) return "";
    const origin = `${MINHA_CASA.lat},${MINHA_CASA.lon}`;
    const destination = origin;
    const waypoints = orderedPedidos.map((p) => pedidoHasCoords(p) ? `${p.latitude},${p.longitude}` : encodeURIComponent(p.endereco || `${p.rua || ""} ${p.numero || ""} ${p.cidade || ""}`)).join("|");
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving&waypoints=${encodeURIComponent(waypoints)}`;
  };

  const calculatePizzaCost = (pizzaId, ingredientsSource = database.ingredientes) => {
    const receita = database.receitas.find((r) => r.pizzaId === pizzaId);
    if (!receita || !receita.ingredientes) return 0;
    return receita.ingredientes.reduce((total, itemReceita) => {
      const ingrediente = ingredientsSource.find((i) => i.id === itemReceita.ingredienteId);
      return total + (ingrediente ? ingrediente.custo * itemReceita.qtd : 0);
    }, 0);
  };

  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  window.calcularFrete = async () => {
    const endereco = document.getElementById("pedido-endereco")?.value;
    const cidade = document.getElementById("pedido-cidade")?.value;

    if (!endereco || !cidade) {
      alert("Preencha o endereço e a cidade para calcular o frete.");
      return;
    }

    showLoader();
    try {
      const query = `${endereco}, ${cidade}`;
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data && data.length > 0) {
        const latCliente = parseFloat(data[0].lat);
        const lonCliente = parseFloat(data[0].lon);

        const distancia = getDistanceFromLatLonInKm(MINHA_CASA.lat, MINHA_CASA.lon, latCliente, lonCliente);
        const freteSugerido = distancia * VALOR_POR_KM;

        if (confirm(`Distância estimada: ${distancia.toFixed(1)} km
Frete Sugerido: R$ ${freteSugerido.toFixed(2)}

Deseja adicionar esse frete ao Valor Final?`)) {
          const inputValorFinal = document.getElementById("valor-final-pedido");
          const valorAtual = parseFloat(inputValorFinal.value || document.getElementById("total-calculado-pedido").textContent.replace("R$ ", "").replace(",", ".") || 0);
          inputValorFinal.value = (valorAtual + freteSugerido).toFixed(2);
        }
      } else {
        alert("Endereço não encontrado pela API de mapas. Tente detalhar mais a rua.");
      }
    } catch (error) {
      alert("Erro ao conectar com a API de mapas.");
    } finally {
      hideLoader();
    }
  };

  const loadDataFromSupabase = async () => {
    showLoader();
    try {
      const results = await Promise.all([
        supabaseClient.from("ingredientes").select("*").order("nome"),
        supabaseClient.from("estoque").select("*").order("nome"),
        supabaseClient.from("receitas").select("*"),
        supabaseClient.from("pedidos").select("*").order("created_at", { ascending: false }),
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
      window.__sassesDebug = window.__sassesDebug || {};
      window.__sassesDebug.pedidos = database.pedidos;
      database.clientes = results[4].data || [];
      database.massas = results[5].data || [];
      database.massas_semanais = results[6].data || [];

      try {
        const caixaRes = await supabaseClient.from("caixa_movimentos").select("*").order("data", { ascending: false });
        database.caixa_movimentos = caixaRes.data || [];
      } catch (e) { database.caixa_movimentos = []; }

      try {
        const vendedoresRes = await supabaseClient.from("vendedores").select("*").order("nome");
        database.vendedores = vendedoresRes.data || [];
      } catch (e) { database.vendedores = []; }

      try {
        const calendarioRes = await supabaseClient
          .from("loja_entrega_calendario")
          .select("*")
          .order("data", { ascending: true })
          .order("cidade", { ascending: true });
        database.loja_entrega_calendario = calendarioRes.data || [];
      } catch (e) { database.loja_entrega_calendario = []; }

      try {
        const recorrenciaRes = await supabaseClient
          .from("loja_entrega_recorrencia")
          .select("*")
          .order("cidade", { ascending: true })
          .order("dia_semana", { ascending: true });
        database.loja_entrega_recorrencia = recorrenciaRes.data || [];
      } catch (e) { database.loja_entrega_recorrencia = []; }

      await syncClientsFromOrders();
      renderAll();
    } catch (error) {
      console.error(error);
      showSaveStatus("Não foi possível carregar os dados agora.", false);
    } finally {
      hideLoader();
    }
  };

  const syncClientsFromOrders = async () => {
    const existingClientKeys = new Set(
      database.clientes.map((c) => `${c.nome.toLowerCase()}|${c.cidade.toLowerCase()}`)
    );
    const newClientsMap = new Map();

    database.pedidos.forEach((pedido) => {
      if (pedido.cliente && pedido.cidade) {
        const clientKey = `${pedido.cliente.toLowerCase()}|${pedido.cidade.toLowerCase()}`;
        if (!existingClientKeys.has(clientKey) && !newClientsMap.has(clientKey)) {
          newClientsMap.set(clientKey, {
            nome: pedido.cliente,
            cidade: pedido.cidade,
            telefone: pedido.telefone || null,
            endereco: pedido.endereco || null,
          });
        }
      }
    });

    const clientsToUpsert = Array.from(newClientsMap.values());
    if (clientsToUpsert.length > 0) {
      const { data, error } = await supabaseClient
        .from("clientes")
        .upsert(clientsToUpsert, { onConflict: "nome,cidade" })
        .select();
      if (data) database.clientes = [...database.clientes, ...data];
    }
  };



  const getLogisticaPedidos = () => {
    const today = formatDateToYYYYMMDD(new Date());
    const max = new Date();
    max.setDate(max.getDate() + 35);
    const maxDate = formatDateToYYYYMMDD(max);
    return database.pedidos
      .filter((p) => p.dataEntrega && p.dataEntrega >= today && p.dataEntrega <= maxDate)
      .filter((p) => !STOCK_RELEASED_STATUSES.includes(p.status))
      .sort((a, b) => `${a.dataEntrega || ""} ${a.horario_preferencia || ""}`.localeCompare(`${b.dataEntrega || ""} ${b.horario_preferencia || ""}`));
  };

  const populateLogisticaFilters = () => {
    const cities = [...new Set(database.pedidos.map((p) => (p.cidade || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    ["logistica-cidade-filter", "rota-cidade-filter"].forEach((id) => {
      const select = document.getElementById(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">Todas as cidades</option>' + cities.map((city) => `<option value="${escapeAttr(city)}">${escapeHTML(city)}</option>`).join("");
      if (cities.includes(current)) select.value = current;
    });
    const rotaData = document.getElementById("rota-data-filter");
    if (rotaData && !rotaData.value) rotaData.value = formatDateToYYYYMMDD(new Date());
  };

  const renderLogisticaAgenda = () => {
    const container = document.getElementById("logistica-agenda");
    const routePanel = document.getElementById("rota-entrega-panel");
    if (!container) return;
    populateLogisticaFilters();
    const cidade = (document.getElementById("logistica-cidade-filter")?.value || "").toLowerCase();
    const tipo = document.getElementById("logistica-tipo-filter")?.value || "";
    const pedidos = getLogisticaPedidos().filter((p) => {
      const cityOk = !cidade || (p.cidade || "").toLowerCase() === cidade;
      const tipoOk = !tipo || normalizeMetodoEntrega(p) === tipo;
      return cityOk && tipoOk;
    });

    if (!pedidos.length) {
      container.innerHTML = '<div class="empty-state">Nenhum pedido agendado para os próximos dias.</div>';
      if (routePanel && !routePanel.innerHTML) routePanel.innerHTML = '<div class="empty-state">Escolha um dia para montar a rota.</div>';
      return;
    }

    const grouped = pedidos.reduce((acc, pedido) => {
      const key = pedido.dataEntrega || "Sem data";
      if (!acc[key]) acc[key] = [];
      acc[key].push(pedido);
      return acc;
    }, {});

    container.innerHTML = Object.entries(grouped).map(([date, list]) => {
      const entregas = list.filter((p) => normalizeMetodoEntrega(p) === "entrega").length;
      const retiradas = list.length - entregas;
      return `
        <article class="logistica-day-card">
          <header>
            <div><strong>${formatDateBR(date)}</strong><small>${list.length} pedido(s)</small></div>
            <div class="logistica-day-tags"><span>Entregas: ${entregas}</span><span>Retiradas: ${retiradas}</span></div>
          </header>
          <div class="logistica-order-list">
            ${list.map((p) => `
              <div class="logistica-order-item ${normalizeMetodoEntrega(p)}">
                <b>${escapeHTML(formatHoraPreferencia(p.horario_preferencia))} · ${escapeHTML(p.cliente || "Cliente")}</b>
                <span>${getMetodoEntregaLabel(p)} · ${escapeHTML(p.cidade || "-")}</span>
                <small>${escapeHTML(p.endereco || "-")}</small>
              </div>
            `).join("")}
          </div>
        </article>`;
    }).join("");
  };

  const calcularRotaEntregas = () => {
    const panel = document.getElementById("rota-entrega-panel");
    if (!panel) return;
    const data = document.getElementById("rota-data-filter")?.value || formatDateToYYYYMMDD(new Date());
    const cidade = (document.getElementById("rota-cidade-filter")?.value || "").toLowerCase();
    let entregas = getLogisticaPedidos().filter((p) => normalizeMetodoEntrega(p) === "entrega" && p.dataEntrega === data);
    if (cidade) entregas = entregas.filter((p) => (p.cidade || "").toLowerCase() === cidade);

    if (!entregas.length) {
      panel.innerHTML = '<div class="empty-state">Nenhuma entrega para esse filtro.</div>';
      return;
    }

    const semCoords = entregas.filter((p) => !pedidoHasCoords(p));
    let pendentes = entregas.filter((p) => pedidoHasCoords(p));
    const ordenados = [];
    let atual = { ...MINHA_CASA };
    while (pendentes.length) {
      pendentes.sort((a, b) => distanceKm(atual, getPedidoCoords(a)) - distanceKm(atual, getPedidoCoords(b)));
      const next = pendentes.shift();
      ordenados.push(next);
      atual = getPedidoCoords(next);
    }

    const mapsUrl = buildGoogleMapsRouteUrl(ordenados);
    const totalKm = ordenados.reduce((sum, pedido, index) => {
      const from = index === 0 ? MINHA_CASA : getPedidoCoords(ordenados[index - 1]);
      return sum + distanceKm(from, getPedidoCoords(pedido));
    }, 0) + (ordenados.length ? distanceKm(getPedidoCoords(ordenados[ordenados.length - 1]), MINHA_CASA) : 0);

    panel.innerHTML = `
      <div class="rota-summary">
        <strong>${ordenados.length} entrega(s) com rota</strong>
        <span>${Number.isFinite(totalKm) ? `${totalKm.toFixed(1).replace('.', ',')} km aproximados` : 'Distância indisponível'}</span>
        ${mapsUrl ? `<a class="action-btn" href="${mapsUrl}" target="_blank" rel="noopener">Abrir no Google Maps</a>` : ''}
      </div>
      <ol class="rota-list">
        ${ordenados.map((p, index) => `<li><b>${index + 1}. ${escapeHTML(p.cliente || "Cliente")}</b><span>${escapeHTML(formatHoraPreferencia(p.horario_preferencia))} · ${escapeHTML(p.cidade || "-")}</span><small>${escapeHTML(p.endereco || "-")}</small></li>`).join("")}
      </ol>
      ${semCoords.length ? `<div class="notice-list"><div class="notification-item warning"><b>${semCoords.length} entrega(s) sem localização</b><span>Esses pedidos precisam de latitude/longitude para entrar na rota automática.</span></div></div>` : ''}
    `;
  };

  const getLojaWeekdayLabel = (value) => (LOJA_WEEKDAYS.find((d) => d.value === Number(value))?.label || "Dia");
  const getLojaWeekdayShort = (value) => (LOJA_WEEKDAYS.find((d) => d.value === Number(value))?.short || "Dia");

  const populateLojaCalendarCityDatalist = () => {
    const datalist = document.getElementById("loja-cal-cidades-list");
    if (!datalist) return;
    const cities = [...new Set([
      ...database.clientes.map((c) => c.cidade),
      ...database.pedidos.map((p) => p.cidade),
      ...database.loja_entrega_calendario.map((e) => e.cidade),
      ...database.loja_entrega_recorrencia.map((e) => e.cidade),
      "Jaraguá do Sul", "Massaranduba", "Blumenau", "Guaramirim"
    ].map((v) => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    datalist.innerHTML = cities.map((city) => `<option value="${escapeAttr(city)}"></option>`).join("");
  };

  const getLojaCalendarMonthKey = () => `${lojaCalendarMonth.getFullYear()}-${String(lojaCalendarMonth.getMonth() + 1).padStart(2, "0")}`;
  const getLojaCalendarCity = () => document.getElementById("loja-cal-cidade")?.value.trim() || "";
  const getLojaCalendarCityKey = () => normalizeCidadeKey(getLojaCalendarCity());

  const getExistingDeliveryDaysForCurrentCity = () => {
    const cityKey = getLojaCalendarCityKey();
    const monthKey = getLojaCalendarMonthKey();
    if (!cityKey) return {};
    return database.loja_entrega_calendario
      .filter((entry) => normalizeCidadeKey(entry.cidade) === cityKey && String(entry.data || "").startsWith(monthKey))
      .reduce((acc, entry) => {
        if (!acc[entry.data]) acc[entry.data] = [];
        acc[entry.data].push(entry);
        return acc;
      }, {});
  };

  const getExistingRecurrencesForCurrentCity = () => {
    const cityKey = getLojaCalendarCityKey();
    if (!cityKey) return [];
    return database.loja_entrega_recorrencia.filter((entry) => normalizeCidadeKey(entry.cidade) === cityKey);
  };

  const getActiveRecurrenceWeekdaysForCurrentCity = () => new Set(
    getExistingRecurrencesForCurrentCity()
      .filter((entry) => entry.ativo !== false)
      .map((entry) => Number(entry.dia_semana))
  );

  const setLojaCalendarMode = (mode) => {
    lojaCalendarMode = mode === "recorrente" ? "recorrente" : "datas";
    document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
      const active = button.dataset.calendarMode === lojaCalendarMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-calendar-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.calendarPanel !== lojaCalendarMode;
    });
    if (lojaCalendarMode === "recorrente") renderLojaRecorrenciaPanel();
    else renderLojaCalendarioGrade();
  };

  const renderLojaCalendarioGrade = () => {
    const grid = document.getElementById("loja-calendario-grade");
    const label = document.getElementById("loja-cal-month-label");
    const counter = document.getElementById("loja-cal-selected-count");
    const selectedList = document.getElementById("loja-cal-selected-list");
    if (!grid) return;

    const monthLabel = lojaCalendarMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    if (label) label.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    const city = getLojaCalendarCity();
    const existingByDate = getExistingDeliveryDaysForCurrentCity();
    const recurrenceWeekdays = getActiveRecurrenceWeekdaysForCurrentCity();
    const today = formatDateToYYYYMMDD(new Date());
    const year = lojaCalendarMonth.getFullYear();
    const month = lojaCalendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startOffset = first.getDay();
    const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

    const cells = weekDays.map((day) => `<div class="bulk-calendar-weekday">${day}</div>`);
    for (let i = 0; i < startOffset; i++) cells.push('<div class="bulk-calendar-empty"></div>');

    for (let day = 1; day <= last.getDate(); day++) {
      const date = new Date(year, month, day);
      const iso = formatDateToYYYYMMDD(date);
      const isPast = iso < today;
      const existing = existingByDate[iso] || [];
      const hasOneOffActive = existing.some((entry) => entry.ativo !== false);
      const hasPausedDate = existing.length && !hasOneOffActive;
      const isRecurring = recurrenceWeekdays.has(date.getDay()) && !hasPausedDate;
      const isSelected = lojaCalendarSelectedDates.has(iso);
      const isAlreadyAvailable = hasOneOffActive || isRecurring;
      const disabled = isPast || isAlreadyAvailable;
      const labelText = hasOneOffActive ? "Marcado" : hasPausedDate ? "Pausado" : isRecurring ? "Recorrente" : isSelected ? "Selecionado" : "";
      cells.push(`
        <button type="button" class="bulk-calendar-day ${isSelected ? 'is-selected' : ''} ${hasOneOffActive ? 'is-registered' : ''} ${isRecurring ? 'is-recurring' : ''} ${hasPausedDate ? 'is-paused' : ''} ${isPast ? 'is-past' : ''}" data-date="${iso}" ${disabled ? 'disabled' : ''}>
          <strong>${day}</strong>
          <span>${labelText}</span>
        </button>`);
    }

    grid.innerHTML = cells.join("");
    grid.querySelectorAll(".bulk-calendar-day[data-date]:not(:disabled)").forEach((button) => {
      button.addEventListener("click", () => {
        const date = button.dataset.date;
        if (lojaCalendarSelectedDates.has(date)) lojaCalendarSelectedDates.delete(date);
        else lojaCalendarSelectedDates.add(date);
        renderLojaCalendarioGrade();
      });
    });

    const selectedDates = [...lojaCalendarSelectedDates].sort();
    if (counter) {
      const count = selectedDates.length;
      counter.textContent = count ? `${count} dia(s) selecionado(s)${city ? ` para ${city}` : ''}.` : 'Nenhum dia selecionado.';
    }
    if (selectedList) {
      selectedList.innerHTML = selectedDates.length
        ? selectedDates.map((date) => `<button type="button" class="selected-day-chip" data-remove-date="${date}">${formatDateBR(date)} <span>×</span></button>`).join("")
        : '<div class="empty-state compact">Clique nos dias do calendário para marcar entregas avulsas.</div>';
      selectedList.querySelectorAll('[data-remove-date]').forEach((button) => {
        button.addEventListener('click', () => {
          lojaCalendarSelectedDates.delete(button.dataset.removeDate);
          renderLojaCalendarioGrade();
        });
      });
    }
  };

  const renderLojaRecorrenciaPanel = () => {
    const container = document.getElementById("loja-recorrencia-weekdays");
    const counter = document.getElementById("loja-rec-selected-count");
    if (!container) return;
    const existing = getExistingRecurrencesForCurrentCity();
    const active = new Set(existing.filter((entry) => entry.ativo !== false).map((entry) => Number(entry.dia_semana)));
    const paused = new Set(existing.filter((entry) => entry.ativo === false).map((entry) => Number(entry.dia_semana)));

    container.innerHTML = LOJA_WEEKDAYS.map((day) => {
      const selected = lojaCalendarSelectedWeekdays.has(day.value);
      const isActive = active.has(day.value);
      const isPaused = paused.has(day.value);
      return `<button type="button" class="weekday-toggle ${selected ? 'is-selected' : ''} ${isActive ? 'is-registered' : ''} ${isPaused ? 'is-paused' : ''}" data-weekday="${day.value}">
        <strong>${day.short}</strong>
        <span>${isActive ? 'Recorrente' : isPaused ? 'Pausado' : selected ? 'Selecionado' : day.label}</span>
      </button>`;
    }).join("");

    container.querySelectorAll("[data-weekday]").forEach((button) => {
      button.addEventListener("click", () => {
        const day = Number(button.dataset.weekday);
        if (lojaCalendarSelectedWeekdays.has(day)) lojaCalendarSelectedWeekdays.delete(day);
        else lojaCalendarSelectedWeekdays.add(day);
        renderLojaRecorrenciaPanel();
      });
    });

    if (counter) {
      const selected = [...lojaCalendarSelectedWeekdays].sort((a, b) => a - b).map(getLojaWeekdayLabel);
      counter.textContent = selected.length ? `${selected.length} dia(s) da semana selecionado(s): ${selected.join(', ')}.` : 'Nenhum dia da semana selecionado.';
    }
  };

  const renderLojaCalendario = () => {
    const list = document.getElementById("loja-calendario-list");
    if (!list) return;
    populateLojaCalendarCityDatalist();
    renderLojaCalendarioGrade();
    renderLojaRecorrenciaPanel();
    setLojaCalendarMode(lojaCalendarMode);

    const today = formatDateToYYYYMMDD(new Date());
    const recorrencias = database.loja_entrega_recorrencia
      .slice()
      .sort((a, b) => `${a.cidade} ${a.dia_semana}`.localeCompare(`${b.cidade} ${b.dia_semana}`));
    const datas = database.loja_entrega_calendario
      .filter((entry) => entry.data >= today)
      .sort((a, b) => `${a.cidade} ${a.data}`.localeCompare(`${b.cidade} ${b.data}`));

    if (!recorrencias.length && !datas.length) {
      list.innerHTML = '<div class="empty-state compact">Nenhuma entrega cadastrada.</div>';
      return;
    }

    const recorrenciasByCity = recorrencias.reduce((acc, entry) => {
      const key = normalizeCidadeKey(entry.cidade);
      if (!acc[key]) acc[key] = { cidade: entry.cidade, entries: [] };
      acc[key].entries.push(entry);
      return acc;
    }, {});
    const datasByCity = datas.reduce((acc, entry) => {
      const key = normalizeCidadeKey(entry.cidade);
      if (!acc[key]) acc[key] = { cidade: entry.cidade, entries: [] };
      acc[key].entries.push(entry);
      return acc;
    }, {});

    const recorrenciasHtml = Object.values(recorrenciasByCity).map((group) => {
      const ativos = group.entries.filter((entry) => entry.ativo !== false).sort((a, b) => Number(a.dia_semana) - Number(b.dia_semana));
      const pausados = group.entries.filter((entry) => entry.ativo === false).sort((a, b) => Number(a.dia_semana) - Number(b.dia_semana));
      return `<article class="calendar-city-card recurrence-card">
        <header><div><strong>${escapeHTML(group.cidade)}</strong><small>${ativos.length} recorrente(s) · ${pausados.length} pausado(s)</small></div></header>
        <div class="calendar-chip-list">
          ${ativos.map((entry) => `<div class="calendar-date-chip recurring"><span>${getLojaWeekdayLabel(entry.dia_semana)}</span><div class="calendar-chip-actions"><button class="mini-btn" type="button" onclick="window.toggleLojaRecorrencia('${entry.id}', false)">Pausar</button><button class="mini-btn danger" type="button" onclick="window.deleteLojaRecorrencia('${entry.id}')">Remover</button></div></div>`).join('')}
          ${pausados.map((entry) => `<div class="calendar-date-chip paused"><span>${getLojaWeekdayLabel(entry.dia_semana)}</span><div class="calendar-chip-actions"><button class="mini-btn" type="button" onclick="window.toggleLojaRecorrencia('${entry.id}', true)">Ativar</button><button class="mini-btn danger" type="button" onclick="window.deleteLojaRecorrencia('${entry.id}')">Remover</button></div></div>`).join('')}
        </div>
      </article>`;
    }).join("");

    const datasHtml = Object.values(datasByCity).map((group) => {
      const ativos = group.entries.filter((entry) => entry.ativo !== false).sort((a, b) => a.data.localeCompare(b.data));
      const pausados = group.entries.filter((entry) => entry.ativo === false).sort((a, b) => a.data.localeCompare(b.data));
      return `<article class="calendar-city-card">
        <header><div><strong>${escapeHTML(group.cidade)}</strong><small>${ativos.length} data(s) · ${pausados.length} pausada(s)</small></div></header>
        <div class="calendar-chip-list">
          ${ativos.map((entry) => `<div class="calendar-date-chip active"><span>${formatDateBR(entry.data)}</span><div class="calendar-chip-actions"><button class="mini-btn" type="button" onclick="window.toggleLojaCalendario('${entry.id}', false)">Pausar</button><button class="mini-btn danger" type="button" onclick="window.deleteLojaCalendario('${entry.id}')">Remover</button></div></div>`).join('')}
          ${pausados.map((entry) => `<div class="calendar-date-chip paused"><span>${formatDateBR(entry.data)}</span><div class="calendar-chip-actions"><button class="mini-btn" type="button" onclick="window.toggleLojaCalendario('${entry.id}', true)">Ativar</button><button class="mini-btn danger" type="button" onclick="window.deleteLojaCalendario('${entry.id}')">Remover</button></div></div>`).join('')}
        </div>
      </article>`;
    }).join("");

    list.innerHTML = `
      <div class="calendar-saved-section">
        <h4>Recorrências por dia da semana</h4>
        ${recorrenciasHtml ? `<div class="calendar-city-groups">${recorrenciasHtml}</div>` : '<div class="empty-state compact">Nenhuma recorrência cadastrada.</div>'}
      </div>
      <div class="calendar-saved-section">
        <h4>Dias específicos do mês</h4>
        ${datasHtml ? `<div class="calendar-city-groups">${datasHtml}</div>` : '<div class="empty-state compact">Nenhum dia específico cadastrado.</div>'}
      </div>`;
  };


  const normalizeCupomCodigo = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);

  const resetCupomForm = () => {
    const ids = ['cupom-id', 'cupom-codigo', 'cupom-valor', 'cupom-minimo', 'cupom-inicio', 'cupom-fim', 'cupom-limite'];
    ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
    const tipo = document.getElementById('cupom-tipo');
    if (tipo) tipo.value = 'percentual';
    const ativo = document.getElementById('cupom-ativo');
    if (ativo) ativo.checked = true;
  };

  const renderLojaCupons = () => {
    const list = document.getElementById('loja-cupons-list');
    if (!list) return;
    const cupons = database.loja_cupons || [];
    if (!cupons.length) {
      list.innerHTML = '<div class="empty-state compact">Nenhum cupom cadastrado.</div>';
      return;
    }
    list.innerHTML = cupons.map((cupom) => {
      const valor = cupom.tipo === 'percentual' ? `${Number(cupom.valor || 0).toString().replace('.', ',')}%` : formatCurrency(cupom.valor || 0);
      const validade = [cupom.inicio_em ? `de ${formatDateBR(cupom.inicio_em)}` : '', cupom.fim_em ? `até ${formatDateBR(cupom.fim_em)}` : ''].filter(Boolean).join(' ');
      const usos = cupom.uso_limite ? `${cupom.uso_total || 0}/${cupom.uso_limite} usos` : `${cupom.uso_total || 0} uso(s)`;
      return `<article class="coupon-admin-item ${cupom.ativo === false ? 'is-off' : ''}"><div><strong>${escapeHTML(cupom.codigo)}</strong><small>${escapeHTML(valor)}${cupom.minimo_pedido > 0 ? ` · mínimo ${formatCurrency(cupom.minimo_pedido)}` : ''}${validade ? ` · ${escapeHTML(validade)}` : ''} · ${escapeHTML(usos)}</small></div><div class="coupon-admin-buttons"><button class="mini-btn" type="button" onclick="window.editLojaCupom('${cupom.id}')">Editar</button><button class="mini-btn" type="button" onclick="window.toggleLojaCupom('${cupom.id}', ${cupom.ativo === false ? 'true' : 'false'})">${cupom.ativo === false ? 'Ativar' : 'Pausar'}</button><button class="mini-btn danger" type="button" onclick="window.deleteLojaCupom('${cupom.id}')">Remover</button></div></article>`;
    }).join('');
  };

  window.editLojaCupom = (id) => {
    const cupom = (database.loja_cupons || []).find((item) => item.id === id);
    if (!cupom) return;
    document.getElementById('cupom-id').value = cupom.id;
    document.getElementById('cupom-codigo').value = cupom.codigo || '';
    document.getElementById('cupom-tipo').value = cupom.tipo || 'percentual';
    document.getElementById('cupom-valor').value = cupom.valor || '';
    document.getElementById('cupom-minimo').value = cupom.minimo_pedido || '';
    document.getElementById('cupom-inicio').value = cupom.inicio_em || '';
    document.getElementById('cupom-fim').value = cupom.fim_em || '';
    document.getElementById('cupom-limite').value = cupom.uso_limite || '';
    document.getElementById('cupom-ativo').checked = cupom.ativo !== false;
    document.getElementById('cupom-codigo').focus();
  };

  window.toggleLojaCupom = async (id, ativo) => { try { showLoader(); const { error } = await supabaseClient.from('loja_cupons').update({ ativo }).eq('id', id); if (error) throw error; await loadDataFromSupabase(); showSaveStatus(ativo ? 'Cupom ativado.' : 'Cupom pausado.'); } catch (error) { showSaveStatus(formatSupabaseError(error, 'Não foi possível atualizar o cupom'), false); } finally { hideLoader(); } };
  window.deleteLojaCupom = async (id) => { if (!confirm('Remover esse cupom?')) return; try { showLoader(); const { error } = await supabaseClient.from('loja_cupons').delete().eq('id', id); if (error) throw error; await loadDataFromSupabase(); showSaveStatus('Cupom removido.'); } catch (error) { showSaveStatus(formatSupabaseError(error, 'Não foi possível remover o cupom'), false); } finally { hideLoader(); } };

  const renderLojaHub = () => {
    const kpis = document.getElementById("loja-kpis");
    const confirmList = document.getElementById("loja-confirmacoes-list");
    const catalogList = document.getElementById("loja-catalogo-list");
    const proximosList = document.getElementById("loja-proximos-list");
    if (!kpis || !confirmList || !catalogList || !proximosList) return;
    renderLojaCalendario();
    renderLojaCupons();

    const aguardando = database.pedidos
      .filter((p) => p.status === "Pendente")
      .sort((a, b) => `${a.dataEntrega || ""} ${a.horario_preferencia || ""}`.localeCompare(`${b.dataEntrega || ""} ${b.horario_preferencia || ""}`));
    const entregasHoje = getLogisticaPedidos().filter((p) => normalizeMetodoEntrega(p) === "entrega");
    const retiradasHoje = getLogisticaPedidos().filter((p) => normalizeMetodoEntrega(p) === "retirada");
    const itensVisiveis = database.estoque.filter((p) => p.visivel_loja !== false);
    const itensOcultos = database.estoque.filter((p) => p.visivel_loja === false);
    const itensSemImagem = itensVisiveis.filter((p) => !String(p.imagem_url || "").trim());
    const destaques = itensVisiveis.filter((p) => p.destaque_loja === true);

    kpis.innerHTML = `
      <article class="kpi-card"><span class="kpi-label">Aguardando confirmação</span><strong>${aguardando.length}</strong><small>Pediram e ainda falta confirmar.</small></article>
      <article class="kpi-card"><span class="kpi-label">Sabores visíveis</span><strong>${itensVisiveis.length}</strong><small>${itensOcultos.length} oculto(s) na loja.</small></article>
      <article class="kpi-card"><span class="kpi-label">Entregas na agenda</span><strong>${entregasHoje.length}</strong><small>${retiradasHoje.length} retirada(s) nos próximos dias.</small></article>
      <article class="kpi-card"><span class="kpi-label">Catálogo</span><strong>${destaques.length}</strong><small>destaque(s) · ${itensSemImagem.length} sem imagem.</small></article>
    `;

    confirmList.innerHTML = aguardando.length
      ? `<div class="loja-list">${aguardando.slice(0, 12).map((p) => {
          const resumo = (p.items || []).slice(0, 3).map((it) => `${it.qtd}x ${it.pizzaNome}`).join(" · ") || "Sem itens";
          return `<article class="loja-item">
            <div class="loja-item-main">
              <strong>${escapeHTML(p.cliente || "Cliente")}</strong>
              <span>${escapeHTML(formatPedidoAgenda(p))} · ${escapeHTML(getMetodoEntregaLabel(p))}</span>
              <small>${escapeHTML(resumo)}${(p.items || []).length > 3 ? ` · +${(p.items || []).length - 3} item(ns)` : ""}</small>
            </div>
            <div class="loja-item-actions">
              <button class="action-btn confirm-btn" onclick="window.updatePedidoStatus('${p.id}', 'Confirmado')">Confirmar</button>
              <button class="action-btn reject-btn" onclick="window.updatePedidoStatus('${p.id}', 'Negado')">Rejeitar</button>
              <button class="action-btn edit-btn" onclick="window.openEditPedidoModal('${p.id}')">Editar</button>
            </div>
          </article>`;
        }).join("")}</div>`
      : '<div class="empty-state">Nenhum pedido aguardando confirmação.</div>';

    catalogList.innerHTML = `
      <div class="loja-list compact">
        <div class="loja-item simple"><div class="loja-item-main"><strong>Itens visíveis</strong><small>${itensVisiveis.length} item(ns) aparecendo na loja.</small></div><button class="action-btn info-btn" onclick="window.openTabSection('estoque')">Abrir sabores</button></div>
        <div class="loja-item simple"><div class="loja-item-main"><strong>Itens ocultos</strong><small>${itensOcultos.length} item(ns) escondidos da loja.</small></div><button class="action-btn info-btn" onclick="window.openTabSection('estoque')">Revisar</button></div>
        <div class="loja-item simple"><div class="loja-item-main"><strong>Itens sem imagem</strong><small>${itensSemImagem.length} item(ns) sem foto.</small></div><button class="action-btn info-btn" onclick="window.openTabSection('estoque')">Completar</button></div>
        <div class="loja-item simple"><div class="loja-item-main"><strong>Itens em destaque</strong><small>${destaques.length} item(ns) marcados como destaque.</small></div><button class="action-btn info-btn" onclick="window.openTabSection('estoque')">Ajustar</button></div>
      </div>`;

    const proximos = getLogisticaPedidos().slice(0, 10);
    proximosList.innerHTML = proximos.length
      ? `<div class="loja-list compact">${proximos.map((p) => `<div class="loja-item simple ${normalizeMetodoEntrega(p)}"><div class="loja-item-main"><strong>${escapeHTML(p.cliente || "Cliente")}</strong><span>${escapeHTML(getMetodoEntregaLabel(p))} · ${escapeHTML(formatPedidoAgenda(p))}</span><small>${escapeHTML(p.cidade || "-")} · ${escapeHTML(p.endereco || "-")}</small></div></div>`).join("")}</div>`
      : '<div class="empty-state">Nada agendado para os próximos dias.</div>';
  };

  const applyDefaultPedidosFilters = (force = false) => {
    const statusSelect = document.getElementById("filter-modal-status");
    if (statusSelect && (force || !statusSelect.value)) statusSelect.value = "NaoProntos";

    const semanaSelect = document.getElementById("filter-modal-semana");
    if (semanaSelect) {
      const previous = semanaSelect.value;
      if (semanaSelect.options.length <= 1) {
        populateWeekSelector(semanaSelect, { setCurrentDefault: false, keepPlaceholder: true });
      }
      // Padrão: todas as semanas. O filtro principal já é "Não prontos".
      // Assim nenhum pedido some por estar em outra semana ou com data ajustada.
      if (!force && previous) semanaSelect.value = previous;
      if (force) semanaSelect.value = "";
    }
    if (typeof updateFilterUX === "function") updateFilterUX();
  };

  const renderAll = () => {
    populateSelects();
    populateWeekSelector(undefined, { futureOnly: true, futureWeeks: 24, setCurrentDefault: true });
    populateWeekSelector(document.getElementById("filter-demanda-semana"), { setCurrentDefault: true });
    populateWeekSelector(document.getElementById("dash-week-filter"));
    populateWeekSelector(document.getElementById("quick-semana"), { futureOnly: true, futureWeeks: 24, setCurrentDefault: true });
    populateWeekSelector(document.getElementById("producao-semana"), { futureOnly: true, futureWeeks: 4, setCurrentDefault: true });
    renderIngredientes();
    renderEstoque();
    renderReceitas();

    applyDefaultPedidosFilters(false);

    renderPedidos();
    renderLojaHub();
    renderLogisticaAgenda();
    renderPedidoAtalhos();
    renderClientes();
    renderProductionDemand();
    renderWeeklyMassasPanel();
    renderConsultaRapidaSobras();
    populateClienteDatalist();
    if (typeof renderV4Panels === "function") renderV4Panels();

    const activeRange = document.querySelector(".date-filter.active")?.dataset.range || "all";
    renderDashboard(activeRange);
    refreshNotificationBadge();
  };

  const populateSelects = (selectElementId) => {
    const pizzaEstoqueSelect = document.getElementById(selectElementId || "item-pizza");
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
      const ingredienteReceitaSelect = document.getElementById("receita-ingrediente-select");
      if (!ingredienteReceitaSelect) return;
      const firstOpt = ingredienteReceitaSelect.options[0];
      ingredienteReceitaSelect.innerHTML = "";
      if (firstOpt) ingredienteReceitaSelect.appendChild(firstOpt);
      database.ingredientes.forEach((i) => {
        ingredienteReceitaSelect.innerHTML += `<option value="${i.id}">${i.nome}</option>`;
      });
    }
  };

  const populateWeekSelector = (selectElement, options = {}) => {
    const weekSelect = selectElement || document.getElementById("pedido-semana-entrega");
    if (!weekSelect) return;

    const {
      includeFuture = false,
      futureWeeks = 24,
      pastWeeks = 24,
      setCurrentDefault = false,
      futureOnly = false,
      keepPlaceholder = true,
    } = options;

    const firstOption = weekSelect.options[0];
    weekSelect.innerHTML = "";
    if (firstOption && keepPlaceholder) weekSelect.appendChild(firstOption);

    let offsets = [];
    if (futureOnly) {
      // Registro de pedido: semana atual primeiro e apenas semanas futuras.
      offsets = Array.from({ length: futureWeeks + 1 }, (_, index) => -index);
    } else if (includeFuture) {
      // Uso geral: atual, futuras e depois passadas.
      offsets = [0];
      for (let i = 1; i <= futureWeeks; i++) offsets.push(-i);
      for (let i = 1; i <= pastWeeks; i++) offsets.push(i);
    } else {
      // Relatórios/consultas: atual e semanas anteriores, sem datas futuras.
      offsets = Array.from({ length: pastWeeks + 1 }, (_, index) => index);
    }

    offsets.forEach((offset) => {
      const weekDate = new Date();
      weekDate.setDate(weekDate.getDate() - (offset * 7));

      const startOfWeek = new Date(
        weekDate.setDate(weekDate.getDate() - weekDate.getDay() + (weekDate.getDay() === 0 ? -6 : 1))
      );
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);

      const startFormatted = startOfWeek.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      const endFormatted = endOfWeek.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      const weekValue = formatDateToYYYYMMDD(startOfWeek);

      weekSelect.innerHTML += `<option value="${weekValue}">Semana de ${startFormatted} a ${endFormatted}</option>`;
    });

    if (setCurrentDefault) {
      const currentWeek = getWeekStart();
      weekSelect.value = currentWeek;
      if (weekSelect.value !== currentWeek && weekSelect.options.length > 1) weekSelect.selectedIndex = 1;
    }
  };

  const populateMassasWeekSelector = (weekSelect) => {
    if (!weekSelect) return;
    weekSelect.innerHTML = "";

    const formatWeekOption = (startDate, extraLabel = "") => {
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startFormatted = start.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      const endFormatted = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      const value = formatDateToYYYYMMDD(start);
      return `<option value="${value}">Semana de ${startFormatted} a ${endFormatted}${extraLabel}</option>`;
    };

    const current = new Date(getWeekStart() + "T00:00:00");

    // 1) Atual como padrão
    weekSelect.innerHTML += formatWeekOption(current);

    // 2) Futuras
    for (let i = 1; i <= 24; i++) {
      const future = new Date(current);
      future.setDate(future.getDate() + i * 7);
      weekSelect.innerHTML += formatWeekOption(future);
    }

    // 3) Só a última passada, no fim
    const previous = new Date(current);
    previous.setDate(previous.getDate() - 7);
    weekSelect.innerHTML += formatWeekOption(previous, " — semana passada");

    weekSelect.value = getWeekStart();
  };

  const populateClienteDatalist = () => {
    const datalist = document.getElementById("clientes-list");
    if (!datalist) return;
    datalist.innerHTML = "";
    database.clientes.forEach((cliente) => {
      datalist.innerHTML += `<option value="${cliente.nome}">`;
    });
  };

  const openTab = (tabId) => {
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    document.querySelectorAll(".tab-link").forEach((l) => l.classList.toggle("active", l.dataset.tab === tabId));
    const moreBtn = document.getElementById("btn-more-tabs");
    if (moreBtn) moreBtn.classList.toggle("active", !!document.querySelector(`#more-tabs-menu .tab-link[data-tab="${tabId}"]`));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === tabId));
    if (tabId === "graficos") {
      renderProductionDemand();
      const activeRange = document.querySelector(".date-filter.active")?.dataset.range || "all";
      renderDashboard(activeRange);
    }
    if (tabId === "inicio") renderHome();
    if (tabId === "loja") renderLojaHub();
    if (["vendedor-rapido", "caixa", "producao", "clientes", "cozinha"].includes(tabId) && typeof renderV4Panels === "function") renderV4Panels();
    if (tabId === "cozinha") renderKitchenMode();
  };

  window.openTabSection = openTab;

  const closeMoreMenu = () => {
    const menu = document.getElementById("more-tabs-menu");
    const btn = document.getElementById("btn-more-tabs");
    if (menu) {
      menu.hidden = true;
      menu.classList.remove("is-open");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
  };

  const openMoreMenu = () => {
    const menu = document.getElementById("more-tabs-menu");
    const btn = document.getElementById("btn-more-tabs");
    if (menu) {
      menu.hidden = false;
      menu.classList.add("is-open");
    }
    if (btn) btn.setAttribute("aria-expanded", "true");
  };

  const toggleMoreMenu = () => {
    const menu = document.getElementById("more-tabs-menu");
    if (!menu) return;
    if (menu.hidden || !menu.classList.contains("is-open")) openMoreMenu();
    else closeMoreMenu();
  };

  closeMoreMenu();

  document.getElementById("btn-more-tabs")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMoreMenu();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".more-menu-wrap")) closeMoreMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMoreMenu();
  });

  document.querySelectorAll(".tab-link").forEach((link) => {
    link.addEventListener("click", () => {
      openTab(link.dataset.tab);
      closeMoreMenu();
    });
  });

  document.querySelectorAll("[data-open-tab]").forEach((btn) => {
    btn.addEventListener("click", () => openTab(btn.dataset.openTab));
  });

  const lojaCalendarDetails = document.getElementById("loja-calendar-details");
  const lojaCalendarSummaryAction = document.querySelector(".calendar-summary-action");
  if (lojaCalendarDetails && lojaCalendarSummaryAction) {
    const updateCalendarSummaryLabel = () => {
      lojaCalendarSummaryAction.textContent = lojaCalendarDetails.open ? "Fechar calendário" : "Abrir calendário";
    };
    lojaCalendarDetails.addEventListener("toggle", updateCalendarSummaryLabel);
    updateCalendarSummaryLabel();
  }

  document.getElementById("brand-home")?.addEventListener("click", () => openTab("inicio"));
  document.getElementById("brand-home")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" || e.key === " ") openTab("inicio");
  });
  document.getElementById("btn-profile")?.addEventListener("click", openSellerProfileModal);

  document.getElementById("seller-profile-select")?.addEventListener("change", (e) => {
    const seller = database.vendedores.find((v) => v.id === e.target.value);
    document.getElementById("seller-profile-id").value = seller?.id || "";
    document.getElementById("seller-nome").value = seller?.nome || "";
    document.getElementById("seller-telefone").value = seller?.telefone || "";
    document.getElementById("seller-senha-admin").value = seller?.senha_admin || "";
    document.getElementById("seller-cliente-link").value = seller?.cliente_id || "";
  });

  document.getElementById("seller-cliente-link")?.addEventListener("change", (e) => {
    const cliente = database.clientes.find((c) => c.id === e.target.value);
    if (!cliente) return;
    const nome = document.getElementById("seller-nome");
    const tel = document.getElementById("seller-telefone");
    if (nome && !nome.value) nome.value = cliente.nome || "";
    if (tel && !tel.value) tel.value = cliente.telefone || "";
  });

  document.getElementById("btn-use-seller-profile")?.addEventListener("click", () => {
    const id = document.getElementById("seller-profile-select")?.value;
    if (!id) return showSaveStatus("Selecione um vendedor.", false);
    setCurrentSeller(id);
    closeModal("profile-modal");
    showSaveStatus("Perfil de vendedor ativo neste navegador.");
  });

  document.getElementById("btn-clear-seller-profile")?.addEventListener("click", () => {
    setCurrentSeller("");
    closeModal("profile-modal");
    showSaveStatus("Perfil removido deste navegador.");
  });

  document.getElementById("btn-save-seller-profile")?.addEventListener("click", async () => {
    const id = document.getElementById("seller-profile-id")?.value;
    const payload = {
      nome: document.getElementById("seller-nome")?.value.trim(),
      telefone: document.getElementById("seller-telefone")?.value.trim() || null,
      cliente_id: document.getElementById("seller-cliente-link")?.value || null,
      senha_admin: document.getElementById("seller-senha-admin")?.value.trim() || null,
      ativo: true,
      updated_at: new Date().toISOString(),
    };
    if (!payload.nome) return showSaveStatus("Informe o nome do vendedor.", false);
    showLoader();
    try {
      const result = id
        ? await supabaseClient.from("vendedores").update(payload).eq("id", id).select().single()
        : await supabaseClient.from("vendedores").insert(payload).select().single();
      if (result.error) throw result.error;
      await loadDataFromSupabase();
      setCurrentSeller(result.data.id);
      showSaveStatus("Vendedor salvo e ativado neste navegador.");
      closeModal("profile-modal");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Não foi possível salvar vendedor"), false);
    } finally {
      hideLoader();
    }
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
      if (!isSellerAdmin(getCurrentSeller())) body.classList.remove("admin-mode");
      if (btn) btn.textContent = body.classList.contains("admin-mode") ? "Sair da Visão ADM" : "Entrar na Visão ADM";
      const activeTabIsAdminOnly = document.querySelector(".tab-link.active.admin-only");
      if (activeTabIsAdminOnly) {
        openTab('inicio');
      }
    } else {
      openAuthModal();
    }
  };
  document.getElementById("btn-admin-view").addEventListener("click", toggleAdminView);

  document.getElementById("auth-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const password = document.getElementById("admin-password").value;
    const errorEl = document.getElementById("auth-error");

    if (password === ADMIN_PASSWORD) {
      localStorage.setItem("isAdminLoggedIn", "true");
      document.body.classList.add("admin-mode");
      const adminBtn = document.getElementById("btn-admin-view");
      if (adminBtn) adminBtn.textContent = "Sair da Visão ADM";
      errorEl.style.display = "none";
      closeAuthModal();
      applySellerAccess();
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

    if (callback) callback();
    modal.style.display = "block";

    const firstField = contentContainer?.querySelector("input:not([type='hidden']):not([readonly]), select:not([disabled]), textarea:not([readonly])");
    setTimeout(() => firstField?.focus(), 80);
  };

  window.closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = "none";
      const contentContainer = document.getElementById(`${modalId}-content`);
      if (contentContainer) contentContainer.innerHTML = "";
    }
  };

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

  const renderClientes = () => {
    const tbody = document.getElementById("tabela-clientes")?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document.getElementById("search-clientes").value.toLowerCase();
    let filteredData = database.clientes.filter((c) =>
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
      const hasUnpaid = getClientHasUnpaid(c);
      if (hasUnpaid) row.classList.add("payment-pending-row");
      row.innerHTML = `
                <td data-label="Nome do Cliente">${hasUnpaid ? '<span class="unpaid-alert" title="Pagamento pendente">!</span>' : ''}${c.nome}</td>
                <td data-label="Telefone">${c.telefone || "N/A"}</td>
                <td data-label="Cidade">${c.cidade || "N/A"}<br><small style="color:#777">${c.endereco || ""}</small></td>
                <td data-label="Ações">
                    <button class="action-btn history-btn" onclick="openHistoryModal('${c.id}')">Histórico</button>
                    <button class="action-btn edit-btn" onclick="openEditClientModal('${c.id}')">Editar</button>
                </td>
            `;
    });
    updateSortHeaders("tabela-clientes", column, direction);
  };

  window.openEditClientModal = (id) => {
    const cliente = database.clientes.find((c) => c.id === id);
    if (!cliente) return;
    const insight = typeof getClientInsight === "function" ? getClientInsight(cliente) : null;
    const resumoHTML = insight ? `
      <div class="edit-kpis">
        <div><span>Pedidos</span><b>${insight.pedidos.length}</b></div>
        <div><span>Total comprado</span><b>${formatCurrency(insight.total)}</b></div>
        <div><span>Pendente</span><b>${formatCurrency(insight.valorPendente)}</b></div>
        <div><span>Ticket médio</span><b>${formatCurrency(insight.ticketMedio)}</b></div>
      </div>
      <p class="edit-note">${escapeHTML(insight.reasons.join(" · "))}</p>
    ` : "";

    const formHTML = `
      <form id="edit-client-form" class="edit-form">
        <input type="hidden" name="id" value="${escapeAttr(cliente.id)}">
        ${resumoHTML}
        <div class="edit-section">
          <div class="edit-section-title"><span>Cliente</span><small>Dados principais</small></div>
          <div class="edit-grid two">
            <label>Nome do cliente
              <input type="text" name="nome" value="${escapeAttr(cliente.nome || "")}" required>
            </label>
            <label>Telefone
              <input type="text" name="telefone" value="${escapeAttr(cliente.telefone || "")}" placeholder="Opcional">
            </label>
            <label>Cidade
              <input type="text" name="cidade" value="${escapeAttr(cliente.cidade || "")}" required>
            </label>
            <label>Endereço
              <input type="text" name="endereco" value="${escapeAttr(cliente.endereco || "")}" placeholder="Rua, número, bairro">
            </label>
          </div>
        </div>
        <label class="toggle-line">
          <input type="checkbox" name="syncOrders" checked>
          Atualizar também os pedidos antigos deste cliente
        </label>
        <div class="edit-actions">
          <button type="button" class="secondary-btn" onclick="closeModal('edit-modal')">Cancelar</button>
          <button type="submit">Salvar cliente</button>
        </div>
      </form>
    `;

    openModal("edit-modal", `Editar cliente · ${cliente.nome || ""}`, formHTML, () => {
      document.getElementById("edit-client-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const oldNome = cliente.nome || "";
        const oldCidade = cliente.cidade || "";
        const updatedData = {
          nome: String(formData.get("nome") || "").trim(),
          telefone: String(formData.get("telefone") || "").trim(),
          cidade: String(formData.get("cidade") || "").trim(),
          endereco: String(formData.get("endereco") || "").trim(),
        };

        showLoader();
        try {
          const { error } = await supabaseClient.from("clientes").update(updatedData).eq("id", cliente.id);
          if (error) throw error;

          if (formData.get("syncOrders") === "on") {
            const pedidoUpdate = {
              cliente: updatedData.nome,
              telefone: updatedData.telefone,
              cidade: updatedData.cidade,
              endereco: updatedData.endereco,
            };

            const byId = await supabaseClient.from("pedidos").update(pedidoUpdate).eq("clienteId", cliente.id);
            if (byId.error) throw byId.error;

            const byNameCity = await supabaseClient
              .from("pedidos")
              .update({ ...pedidoUpdate, clienteId: cliente.id })
              .eq("cliente", oldNome)
              .eq("cidade", oldCidade);
            if (byNameCity.error) throw byNameCity.error;
          }

          showSaveStatus("Cliente atualizado com sucesso!");
          closeModal("edit-modal");
          await loadDataFromSupabase();
        } catch (error) {
          showSaveStatus("Erro ao atualizar cliente: " + error.message, false);
        } finally {
          hideLoader();
        }
      };
    });
  };

  window.openHistoryModal = (clientId) => {
    const cliente = database.clientes.find((c) => c.id === clientId);
    if (!cliente) return;

    const pedidosCliente = (typeof getPedidosDoCliente === "function" ? getPedidosDoCliente(cliente) : database.pedidos.filter((p) => p.clienteId === clientId))
      .sort((a, b) => new Date(b.dataEntrega || b.created_at) - new Date(a.dataEntrega || a.created_at));

    const insight = typeof getClientInsight === "function" ? getClientInsight(cliente) : null;
    let tableHTML = "<p>Nenhum pedido encontrado para este cliente.</p>";

    const summaryHTML = insight ? `
      <div class="history-summary">
        <div><span>Pedidos</span><b>${insight.pedidos.length}</b></div>
        <div><span>Total</span><b>${formatCurrency(insight.total)}</b></div>
        <div><span>Pendente</span><b>${formatCurrency(insight.valorPendente)}</b></div>
        <div><span>Ticket médio</span><b>${formatCurrency(insight.ticketMedio)}</b></div>
      </div>
      <p class="small-muted"><b>Leitura inteligente:</b> ${insight.reasons.join("; ")}.</p>
    ` : "";

    if (pedidosCliente.length > 0) {
      tableHTML = `
                ${summaryHTML}
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
        const itemsHtml = (p.items || []).map((i) => `<li>${i.qtd}x ${i.pizzaNome}</li>`).join("");
        const dateSource = p.dataEntrega || p.created_at || "";
        const startOfWeek = new Date(dateSource.includes("T") ? dateSource : dateSource + "T00:00:00");
        const weekStartFormatted = startOfWeek.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
        const valorExibido = p.valorFinal || p.valorTotal;
        const payTag = !isPedidoAtivoFinanceiro(p) ? '<span class="payment-tag muted">Sem cobrança</span>' : (isPedidoPago(p) ? '<span class="payment-tag paid">Pago</span>' : '<span class="payment-tag unpaid">Pendente</span>');
        tableHTML += `
                    <tr>
                        <td>${weekStartFormatted}</td>
                        <td><ul>${itemsHtml}</ul></td>
                        <td>${formatCurrency(valorExibido)}</td>
                        <td><span class="status-${normalizeStatusClass(p.status)}">${p.status}</span>${payTag}</td>
                    </tr>
                `;
      });
      tableHTML += "</tbody></table>";
    }
    openModal("history-modal", `Histórico de ${cliente.nome}`, tableHTML);
  };

  document.getElementById("search-clientes")?.addEventListener("input", renderClientes);

  const renderPedidos = () => {
    const tbody = document.getElementById("tabela-pedidos")?.querySelector("tbody");
    if (!tbody) return;

    const searchTerm = (document.getElementById("search-pedidos")?.value || "").toLowerCase();
    const clienteFilter = (document.getElementById("filter-modal-cliente")?.value || "").toLowerCase();
    const cidadeFilter = (document.getElementById("filter-modal-cidade")?.value || "").toLowerCase();
    const vendedorFilter = document.getElementById("filter-modal-vendedor")?.value || "";
    const semanaFilter = document.getElementById("filter-modal-semana")?.value || "";
    const statusFilter = document.getElementById("filter-modal-status")?.value || "";
    const pagamentoStatusFilter = document.getElementById("filter-modal-pagamento-status")?.value || "";
    const formaPagamentoFilter = document.getElementById("filter-modal-forma-pagamento")?.value || "";
    const valorMin = getNumberValue(document.getElementById("filter-modal-valor-min")?.value, 0);
    const valorMaxRaw = document.getElementById("filter-modal-valor-max")?.value;
    const valorMax = valorMaxRaw ? getNumberValue(valorMaxRaw, Infinity) : Infinity;

    let filteredData = database.pedidos.filter((p) => {
      const searchMatch = (p.cliente || "").toLowerCase().includes(searchTerm);
      const clienteMatch = !clienteFilter || (p.cliente || "").toLowerCase().includes(clienteFilter);
      const cidadeMatch = !cidadeFilter || (p.cidade || "").toLowerCase().includes(cidadeFilter);
      const vendedorName = (p.vendedor || "").trim();
      const vendedorFirstName = vendedorName.split(" ")[0];
      const normalizedVendedor = vendedorFirstName.charAt(0).toUpperCase() + vendedorFirstName.slice(1).toLowerCase();
      const vendedorMatch = !vendedorFilter || normalizedVendedor === vendedorFilter || vendedorName.toLowerCase() === vendedorFilter.toLowerCase();
      const semanaMatch = !semanaFilter || (p.dataEntrega && getWeekStart(p.dataEntrega) === semanaFilter);
      const pedidoStatus = p.status || "Pendente";
      const statusMatch = !statusFilter
        || (statusFilter === "NaoProntos" ? ["Pendente", "Confirmado"].includes(pedidoStatus) : false)
        || (statusFilter === "ConfirmadoNaoConcluido" ? ["Confirmado", "Pronto"].includes(pedidoStatus) : false)
        || pedidoStatus === statusFilter;
      const pagamentoStatusMatch = !pagamentoStatusFilter || (pagamentoStatusFilter === "pago" ? isPedidoPago(p) : (isPedidoAtivoFinanceiro(p) && !isPedidoPago(p)));
      const formaPagamentoMatch = !formaPagamentoFilter || p.pagamento === formaPagamentoFilter;
      const valorExibido = p.valorFinal || p.valorTotal;
      const valorMatch = valorExibido >= valorMin && valorExibido <= valorMax;

      return searchMatch && clienteMatch && cidadeMatch && vendedorMatch && semanaMatch && statusMatch && pagamentoStatusMatch && formaPagamentoMatch && valorMatch;
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
    if (!filteredData.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-row">
        Nenhum pedido encontrado com esses filtros.
        <button type="button" class="inline-reset-btn" onclick="window.resetPedidoFilters?.()">Limpar filtros</button>
      </td></tr>`;
      updateSortHeaders("tabela-pedidos", column, direction);
      return;
    }
    filteredData.forEach((p) => {
      const row = tbody.insertRow();
      const itemsHtml = p.items.map((i) => `<li class="${i.isCustom ? "item-pedido-outro" : ""}">${i.qtd}x ${i.pizzaNome}</li>`).join("");
      const statusClass = normalizeStatusClass(p.status);
      const valorExibido = p.valorFinal || p.valorTotal;
      const pago = isPedidoPago(p);
      const pagamentoTag = !isPedidoAtivoFinanceiro(p) ? '<span class="payment-tag muted">Sem cobrança</span>' : (pago ? '<span class="payment-tag paid">Pago</span>' : '<span class="payment-tag unpaid">Pagamento pendente</span>');
      const pedidoMeta = getPedidoStatusMeta(p);
      const estoqueMeta = getEstoqueStatusMeta(p);
      const atendimentoMeta = getAtendimentoStatusMeta(p);
      const metodoTag = normalizeMetodoEntrega(p) === "entrega" ? '<span class="payment-tag info">Entrega</span>' : '<span class="payment-tag muted">Retirada</span>';
      const freteInfo = normalizeMetodoEntrega(p) === "entrega" ? `<br><small>Frete: ${formatCurrency(p.frete || 0)}${p.distancia_km ? ` · ${Number(p.distancia_km).toFixed(1).replace('.', ',')} km` : ''}</small>` : '';

      row.innerHTML = `
                <td data-label="Cliente">${escapeHTML(p.cliente)}</b><br><small>${escapeHTML(p.telefone || "N/A")}</small></td>
                <td data-label="Data/horário"><b>${formatPedidoAgenda(p)}</b><br><small>${p.tipo_pedido === "encomenda" ? "Por encomenda" : "Disponível agora"}</small></td>
                <td data-label="Itens"><ul style="padding-left:15px;margin:0">${itemsHtml}</ul></td>
                <td data-label="Entrega/Retirada">${metodoTag}<br><small>Cid.: ${escapeHTML(p.cidade || "-")}<br>${escapeHTML(p.endereco || "-")}</small>${freteInfo}</td>
                <td data-label="Valores"><b>${formatCurrency(valorExibido)}</b><br><small class="admin-only">Produtos: ${formatCurrency(p.subtotal_produtos || p.valorTotal)}</small><br>${pagamentoTag}</td>
                <td data-label="Situação">
                  <div class="status-stack">
                    <div class="status-row"><span class="status-key">${pedidoMeta.title}</span><span class="status-chip ${pedidoMeta.tone}">${pedidoMeta.label}</span></div>
                    <div class="status-row"><span class="status-key">${estoqueMeta.title}</span><span class="status-chip ${estoqueMeta.tone}">${estoqueMeta.label}</span></div>
                    <div class="status-row"><span class="status-key">${atendimentoMeta.title}</span><span class="status-chip ${atendimentoMeta.tone}">${atendimentoMeta.label}</span></div>
                  </div>
                </td>
                <td data-label="Ações">${renderActionButtons(p)}</td>
            `;
    });
    updateSortHeaders("tabela-pedidos", column, direction);
  };

  document.getElementById("search-pedidos")?.addEventListener("input", renderPedidos);
  document.getElementById("logistica-cidade-filter")?.addEventListener("change", renderLogisticaAgenda);
  document.getElementById("logistica-tipo-filter")?.addEventListener("change", renderLogisticaAgenda);
  document.getElementById("rota-cidade-filter")?.addEventListener("change", calcularRotaEntregas);
  document.getElementById("rota-data-filter")?.addEventListener("change", calcularRotaEntregas);
  document.getElementById("btn-calcular-rota")?.addEventListener("click", calcularRotaEntregas);

  const renderActionButtons = (pedido) => {
    const cancelarBtn = STOCK_RELEASED_STATUSES.includes(pedido.status) ? "" : `<button class="action-btn remove-btn" onclick="window.cancelarPedido('${pedido.id}')">Cancelar</button>`;
    const editarBtn = `<button class="action-btn edit-btn" onclick="window.openEditPedidoModal('${pedido.id}')">Editar</button>`;
    const pagoBtn = isPedidoPago(pedido) || STOCK_RELEASED_STATUSES.includes(pedido.status) ? "" : `<button class="action-btn paid-btn complete-btn" onclick="window.marcarPedidoPago('${pedido.id}')">Pago</button>`;
    const pixBtn = `<button class="action-btn info-btn" onclick="window.openPedidoPix('${pedido.id}')">Pix</button>`;
    const printBtn = `<button class="action-btn info-btn" onclick="window.printPedido('${pedido.id}')">🖨️</button>`;
    const confirmarBtn = `<button class="action-btn confirm-btn" onclick="window.updatePedidoStatus('${pedido.id}', 'Confirmado')">Confirmar</button>`;
    const rejeitarBtn = `<button class="action-btn reject-btn" onclick="window.updatePedidoStatus('${pedido.id}', 'Negado')">Rejeitar</button>`;
    const prontoBtn = `<button class="action-btn" style="background-color:var(--accent-color)" onclick="window.updatePedidoStatus('${pedido.id}', 'Pronto')">Marcar pronto</button>`;
    const concluirBtn = `<button class="action-btn complete-btn" onclick="window.updatePedidoStatus('${pedido.id}', 'Concluído')">Concluir</button>`;
    switch (pedido.status) {
      case "Pendente":
        return `${confirmarBtn}${rejeitarBtn}${editarBtn}${pagoBtn}${pixBtn}${printBtn}${cancelarBtn}`;
      case "Confirmado":
        return `${editarBtn}${prontoBtn}${pagoBtn}${pixBtn}${printBtn}${cancelarBtn}`;
      case "Pronto":
        return `${editarBtn}${isPedidoPago(pedido) ? concluirBtn : pagoBtn}${pixBtn}${printBtn}${cancelarBtn}`;
      case "Concluído":
        return `${editarBtn}${pixBtn}${printBtn}`;
      case "Cancelado":
      case "Negado":
        return `${editarBtn}${printBtn}`;
      default:
        return `${editarBtn}${pagoBtn}${pixBtn}${printBtn}${cancelarBtn}`;
    }
  };

  window.updatePedidoStatus = async (id, newStatus) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    let targetStatus = newStatus;
    if (pedido && newStatus === "Pronto" && isPedidoPago(pedido)) {
      targetStatus = "Concluído";
    }
    if (!ALL_ORDER_STATUSES.includes(targetStatus)) {
      showSaveStatus(`Status inválido: ${targetStatus}`, false);
      return;
    }
    const label = targetStatus === "Concluído" && newStatus === "Pronto" ? "Concluído" : targetStatus;
    if (!confirm(`Alterar o pedido para "${label}"?`)) return;

    showLoader();
    try {
      const payload = { p_pedido_id: id, p_novo_status: targetStatus };
      if (targetStatus === "Concluído") payload.p_pago = true;
      const { error } = await supabaseClient.rpc("atualizar_status_pedido_seguro", payload);
      if (error) throw error;
      showSaveStatus(targetStatus === "Concluído" ? "Pedido concluído." : "Pedido atualizado.");
      await loadDataFromSupabase();
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Não foi possível atualizar o pedido"), false);
    } finally {
      hideLoader();
    }
  };

  document.getElementById("btn-add-item-pedido")?.addEventListener("click", () => {
    const pizzaSelect = document.getElementById("item-pizza");
    const pizzaId = pizzaSelect.value;
    const qtd = parseInt(document.getElementById("item-qtd").value);
    if (!pizzaId || !qtd || qtd < 1) {
      alert("Selecione uma pizza e informe uma quantidade válida.");
      return;
    }

    let pizzaNome, isCustom = false, preco = 0;
    if (pizzaId === "outro") {
      pizzaNome = document.getElementById("item-pizza-outro-nome").value.trim();
      if (!pizzaNome) {
        alert("Por favor, informe o nome da pizza.");
        return;
      }
      const tamanho = document.getElementById("item-pizza-outro-tamanho").value;
      pizzaNome = `${pizzaNome} (${tamanho})`;
      isCustom = true;
    } else {
      const pizzaData = database.estoque.find((p) => p.id === pizzaId);
      pizzaNome = pizzaData.tamanho ? `${pizzaData.nome} (${pizzaData.tamanho})` : pizzaData.nome;
      preco = pizzaData.precoVenda;
      const disponivel = getAvailableStockForPizza(pizzaId, pedidoAtualItems);
      if (qtd > disponivel) {
        const seguir = confirm(`Estoque atual livre para ${pizzaNome}: ${disponivel}.

Deseja lançar mesmo assim como encomenda/produção pendente?`);
        if (!seguir) return;
      }
    }
    pedidoAtualItems.push({ pizzaId, pizzaNome, qtd, isCustom, preco });
    renderPedidoCarrinho();
    updateTotalPedido();
    pizzaSelect.value = "";
    document.getElementById("item-qtd").value = "1";
    document.getElementById("item-pizza-outro-nome").value = "";
    document.getElementById("item-pizza-outro-nome").classList.add("hidden");
    document.getElementById("item-pizza-outro-tamanho").classList.add("hidden");
  });

  const renderPedidoCarrinho = () => {
    const container = document.getElementById("pedido-itens-carrinho");
    if (!container) return;
    container.innerHTML = "";
    if (pedidoAtualItems.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#777">Nenhuma pizza adicionada.</p>';
      return;
    }
    const pagamento = getPedidoPagamentoAtual();
    pedidoAtualItems.forEach((item, index) => {
      const unitPrice = getPrecoPorPagamento(item.preco, pagamento);
      container.innerHTML += `<div class="carrinho-item"><p><span>${item.qtd}x</span> ${item.pizzaNome} ${item.isCustom ? '<b class="item-pedido-outro">(Outro)</b>' : ""}<small>${formatCurrency(unitPrice)} un.</small></p><button type="button" class="btn-remove-item" onclick="window.removeItemPedido(${index})">X</button></div>`;
    });
  };

  const renderPedidoAtalhos = () => {
    const box = document.getElementById("pedido-pizza-atalhos");
    if (!box) return;
    const term = (document.getElementById("pedido-pizza-search")?.value || "").toLowerCase().trim();
    const pagamento = getPedidoPagamentoAtual();
    const pizzas = database.estoque
      .filter((pizza) => !term || `${pizza.nome} ${pizza.tamanho || ""}`.toLowerCase().includes(term))
      .slice(0, 18);

    box.innerHTML = pizzas.map((pizza) => {
      const label = pizza.tamanho ? `${pizza.nome} (${pizza.tamanho})` : pizza.nome;
      const price = getPrecoPorPagamento(pizza.precoVenda, pagamento);
      const stockClass = Number(pizza.qtd || 0) <= 0 ? "is-empty" : "";
      const weekStart = document.getElementById("pedido-semana-entrega")?.value || getWeekStart();
      return `<button type="button" class="pizza-shortcut ${stockClass}" onclick="window.quickAddPedidoItem('${pizza.id}')">
        <b>${label}</b>
        <small>${formatCurrency(price)} · ${formatStockSobra(pizza.id, weekStart)}</small>
      </button>`;
    }).join("") || `<p class="empty-state compact">Nenhuma pizza encontrada.</p>`;
  };

  window.quickAddPedidoItem = (pizzaId) => {
    const pizzaData = database.estoque.find((p) => p.id === pizzaId);
    if (!pizzaData) return;
    const pizzaNome = pizzaData.tamanho ? `${pizzaData.nome} (${pizzaData.tamanho})` : pizzaData.nome;
    const disponivel = getAvailableStockForPizza(pizzaId, pedidoAtualItems);
    if (disponivel < 1) {
      const seguir = confirm(`Sem estoque livre para ${pizzaNome}.

Deseja lançar mesmo assim como encomenda/produção pendente?`);
      if (!seguir) return;
    }
    const existing = pedidoAtualItems.find((item) => item.pizzaId === pizzaId && !item.isCustom);
    if (existing) existing.qtd += 1;
    else pedidoAtualItems.push({ pizzaId, pizzaNome, qtd: 1, isCustom: false, preco: pizzaData.precoVenda });
    renderPedidoCarrinho();
    updateTotalPedido();
    applySellerProfileToForms(true);
  };

  window.removeItemPedido = (index) => {
    pedidoAtualItems.splice(index, 1);
    renderPedidoCarrinho();
    updateTotalPedido();
  };

  const updateTotalPedido = () => {
    const pagamento = getPedidoPagamentoAtual();
    const desconto = getPedidoDiscountPercent();
    const totalBruto = pedidoAtualItems.reduce((acc, item) => acc + getPrecoPorPagamento(item.preco, pagamento) * item.qtd, 0);
    const totalFinal = applyDiscount(totalBruto, desconto);
    const totalEl = document.getElementById("total-calculado-pedido");
    const finalInput = document.getElementById("valor-final-pedido");
    const discountHint = document.getElementById("pedido-desconto-valor");
    if (totalEl) totalEl.textContent = formatCurrency(totalFinal);
    if (finalInput) finalInput.value = totalFinal.toFixed(2);
    if (discountHint) {
      const discountValue = totalBruto - totalFinal;
      discountHint.textContent = desconto > 0 ? `Economia: ${formatCurrency(discountValue)}` : "";
    }
    renderPedidoCarrinho();
    renderPedidoAtalhos();
  };

  document.getElementById("btn-registrar-pedido")?.addEventListener("click", async () => {
    await registrarNovoPedido();
  });

  document.getElementById("pedido-pagamento")?.addEventListener("change", updateTotalPedido);
  document.getElementById("pedido-desconto")?.addEventListener("input", updateTotalPedido);
  document.getElementById("pedido-desconto")?.addEventListener("blur", (e) => {
    formatPercentField(e.target);
    updateTotalPedido();
  });
  document.getElementById("pedido-pizza-search")?.addEventListener("input", renderPedidoAtalhos);
  document.getElementById("pedido-semana-entrega")?.addEventListener("change", renderPedidoAtalhos);

  document.getElementById("item-pizza")?.addEventListener("change", (e) => {
    const isOutro = e.target.value === "outro";
    document.getElementById("item-pizza-outro-nome")?.classList.toggle("hidden", !isOutro);
    document.getElementById("item-pizza-outro-tamanho")?.classList.toggle("hidden", !isOutro);
    if (isOutro) document.getElementById("item-pizza-outro-nome")?.focus();
  });


  const registrarNovoPedido = async () => {
    if (pedidoAtualItems.length === 0) {
      alert("Adicione pelo menos uma pizza ao pedido.");
      return;
    }
    const clienteNome = document.getElementById("pedido-cliente").value;
    const vendedor = document.getElementById("pedido-vendedor").value;
    const cidade = document.getElementById("pedido-cidade").value;
    const endereco = document.getElementById("pedido-endereco")?.value || "";
    const pagamento = document.getElementById("pedido-pagamento").value;
    const dataEntrega = document.getElementById("pedido-semana-entrega").value;

    if (!clienteNome || !pagamento || !vendedor || !cidade || !dataEntrega) {
      alert("Preencha todos os campos obrigatórios do pedido.");
      return;
    }

    showLoader();

    let cliente = database.clientes.find(
      (c) => c.nome.toLowerCase() === clienteNome.toLowerCase() && c.cidade.toLowerCase() === cidade.toLowerCase()
    );
    let clienteId;

    if (cliente) {
      clienteId = cliente.id;
      if (endereco && cliente.endereco !== endereco) {
        await supabaseClient.from("clientes").update({ endereco: endereco }).eq("id", clienteId);
      }
    } else {
      const { data, error } = await supabaseClient
        .from("clientes")
        .insert({
          nome: clienteNome,
          telefone: document.getElementById("pedido-cliente-telefone").value,
          cidade: cidade,
          endereco: endereco
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

    const itensComPrecoFinal = pedidoAtualItems.map((item) => ({ ...item, preco: getPrecoPorPagamento(item.preco, pagamento) }));
    const valorCalculado = itensComPrecoFinal.reduce((acc, item) => acc + item.preco * item.qtd, 0);
    const valorFinalInput = document.getElementById("valor-final-pedido").value;
    const valorFinal = parseFloat(valorFinalInput.replace(",", ".")) || valorCalculado;

    const newPedidoData = {
      cliente: clienteNome,
      clienteId: clienteId,
      telefone: document.getElementById("pedido-cliente-telefone").value,
      vendedor,
      cidade,
      endereco,
      pagamento,
      dataEntrega,
      status: "Pendente",
      items: itensComPrecoFinal,
      valorTotal: valorCalculado,
      valorFinal: valorFinal,
      pago: false,
    };

    const semanaInicio = getWeekStart(dataEntrega);
    const quotas = database.massas_semanais.find((m) => m.semana_inicio === semanaInicio) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
    const used = computeWeeklyUsage(semanaInicio);
    const newOrderDoughs = { G: 0, P: 0, PC: 0 };

    newPedidoData.items.forEach((item) => {
      if (item.isCustom) return;
      const pizza = database.estoque.find((e) => e.id === item.pizzaId);
      const doughType = mapPizzaToDough(pizza);
      if (doughType) newOrderDoughs[doughType] += Number(item.qtd || 0);
    });

    const exceeds = [];
    if (used.G + newOrderDoughs.G > (quotas.g_semana || 0)) exceeds.push(`G: ${used.G + newOrderDoughs.G}/${quotas.g_semana || 0}`);
    if (used.P + newOrderDoughs.P > (quotas.p_semana || 0)) exceeds.push(`P: ${used.P + newOrderDoughs.P}/${quotas.p_semana || 0}`);
    if (used.PC + newOrderDoughs.PC > (quotas.pc_semana || 0)) exceeds.push(`P de Chocolate: ${used.PC + newOrderDoughs.PC}/${quotas.pc_semana || 0}`);

    if (exceeds.length > 0) {
      hideLoader();
      alert("Limite semanal de massas atingido para: " + exceeds.join(" | ") + ". Ajuste as quantidades ou a semana.");
      return;
    }

    const { data: pedidoSalvo, error: insertError } = await supabaseClient.rpc("criar_pedido_com_reserva", {
      p_pedido: newPedidoData,
    });

    if (insertError) {
      showSaveStatus(formatSupabaseError(insertError, "Erro ao registrar pedido"), false);
      hideLoader();
      return;
    }

    showSaveStatus(pedidoSalvo?.estoque_baixado ? "Pedido registrado e estoque reservado." : "Pedido registrado como encomenda/produção pendente.");
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
    const desconto = document.getElementById("pedido-desconto");
    if (desconto) desconto.value = "";
    const weekSelect = document.getElementById("pedido-semana-entrega");
    if (weekSelect) weekSelect.value = getWeekStart();
    pedidoAtualItems = [];
    renderPedidoCarrinho();
    updateTotalPedido();
  };

  window.cancelarPedido = async (id) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    if (!pedido) return;
    if (pedido.status === "Concluído") {
      alert("Pedido concluído não deve ser cancelado pelo botão rápido. Se foi erro, abra Editar e mude o status manualmente para Cancelado.");
      return;
    }
    if (confirm(`Cancelar o pedido de ${pedido.cliente}? O estoque reservado será devolvido automaticamente.`)) {
      showLoader();
      try {
        const { error } = await supabaseClient.rpc("cancelar_pedido_seguro", { p_pedido_id: id });
        if (error) throw error;
        showSaveStatus("Pedido cancelado e estoque devolvido.");
        await loadDataFromSupabase();
      } catch (error) {
        showSaveStatus(formatSupabaseError(error, "Erro ao cancelar pedido"), false);
      } finally {
        hideLoader();
      }
    }
  };

  window.removerPedido = window.cancelarPedido;

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
                <div class="small-muted">Mostra a semana atual, as próximas semanas e somente a última semana passada.</div>
                <div class="form-row"><label>Massas G (semana)</label><input type="number" id="quota-g" min="0" value="0"></div>
                <div class="form-row"><label>Massas P (semana)</label><input type="number" id="quota-p" min="0" value="0"></div>
                <div class="form-row"><label>Massas P Chocolate (semana)</label><input type="number" id="quota-pc" min="0" value="0"></div>
                <div class="form-row"><button id="btn-salvar-quotas">Salvar</button></div>
                <div id="quota-usage" class="small-muted"></div>
            </div>
        `;

    const sel = document.getElementById(weekOptionsId);
    // Planejamento de massas: semana atual por padrão, semanas futuras e só a última passada.
    populateMassasWeekSelector(sel);

    sel.addEventListener("change", () => {
      loadQuotasIntoForm(sel.value);
      renderQuotaUsage(sel.value);
    });

    const thisWeek = getWeekStart();
    sel.value = thisWeek;
    loadQuotasIntoForm(thisWeek);
    renderQuotaUsage(thisWeek);

    document.getElementById("btn-salvar-quotas").addEventListener("click", async () => {
      const semana_inicio = sel.value;
      const g_semana = parseInt(document.getElementById("quota-g").value) || 0;
      const p_semana = parseInt(document.getElementById("quota-p").value) || 0;
      const pc_semana = parseInt(document.getElementById("quota-pc").value) || 0;
      showLoader();
      const { error } = await supabaseClient
        .from("massas_semanais")
        .upsert({ semana_inicio, g_semana, p_semana, pc_semana }, { onConflict: "semana_inicio" });
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao salvar quotas semanais: " + error.message, false);
      } else {
        showSaveStatus("Quotas semanais salvas!");
        await loadDataFromSupabase();
        renderQuotaUsage(semana_inicio);
      }
    });
  };

  const loadQuotasIntoForm = (weekStart) => {
    const q = database.massas_semanais.find((m) => m.semana_inicio === weekStart);
    document.getElementById("quota-g").value = q ? q.g_semana || 0 : 0;
    document.getElementById("quota-p").value = q ? q.p_semana || 0 : 0;
    document.getElementById("quota-pc").value = q ? q.pc_semana || 0 : 0;
  };

  const mapPizzaToDough = (pizza) => {
    if (!pizza) return null;
    if (pizza.tamanho === "G") return "G";
    if (pizza.tamanho === "P") {
      if (/(chocolate|choc|brigade|doce|nutella|prest[ií]gio|mm|morango|banana|amores)/i.test(pizza.nome)) return "PC";
      return "P";
    }
    return null;
  };

  const computeWeeklyUsage = (weekStart) => {
    const totals = { G: 0, P: 0, PC: 0 };
    database.pedidos.forEach((p) => {
      if (!p.dataEntrega || !orderHoldsStock(p.status)) return;
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
    const q = database.massas_semanais.find((m) => m.semana_inicio === weekStart) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
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
            P de Chocolate: ${used.PC}/${q.pc_semana || 0} (restante ${remaining.PC})
        `;
  };

  const renderProductionDemand = () => {
    const tbody = document.getElementById("tabela-demanda-producao")?.querySelector("tbody");
    if (!tbody) return;

    const sizeFilter = document.getElementById("filter-demanda-tamanho").value;
    const weekFilterSelect = document.getElementById("filter-demanda-semana");
    const selectedWeek = weekFilterSelect.value || getWeekStart();

    if (!weekFilterSelect.value && weekFilterSelect.options.length > 1) {
      weekFilterSelect.value = selectedWeek;
    }

    const demandMap = new Map();
    database.pedidos
      .filter((p) => ["Pendente", "Confirmado"].includes(p.status) && getWeekStart(p.dataEntrega) === selectedWeek)
      .forEach((p) => {
        p.items.forEach((item) => {
          if (!item.isCustom && item.pizzaId) {
            const currentDemand = demandMap.get(item.pizzaId) || 0;
            demandMap.set(item.pizzaId, currentDemand + item.qtd);
          }
        });
      });

    let productionData = database.estoque
      .filter((pizza) => !sizeFilter || pizza.tamanho === sizeFilter)
      .map((pizza) => {
        const quantidadePedidos = demandMap.get(pizza.id) || 0;
        const estoqueAtual = pizza.qtd;
        const sobraProjetada = estoqueAtual - quantidadePedidos;
        return {
          sabor: `${pizza.nome} (${pizza.tamanho})`,
          quantidade: quantidadePedidos,
          estoqueAtual: estoqueAtual,
          sobraProjetada: sobraProjetada,
        };
      })
      .filter((data) => data.quantidade > 0 || data.sobraProjetada > 0);

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
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Nenhuma pizza com pedidos ou sobras para a semana selecionada.</td></tr>';
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
    const cliente = database.clientes.find((c) => c.nome.toLowerCase() === nome.toLowerCase());
    if (cliente) {
      document.getElementById("pedido-cliente-telefone").value = cliente.telefone || "";
      document.getElementById("pedido-cidade").value = cliente.cidade || "";
      if (document.getElementById("pedido-endereco")) {
        document.getElementById("pedido-endereco").value = cliente.endereco || "";
      }
    }
  });

  document.getElementById("filter-demanda-tamanho")?.addEventListener("input", renderProductionDemand);
  document.getElementById("filter-demanda-semana")?.addEventListener("change", renderProductionDemand);

  const renderIngredientes = () => {
    const tbody = document.getElementById("tabela-ingredientes")?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document.getElementById("search-ingredientes").value.toLowerCase();
    let filteredData = database.ingredientes.filter((item) => (item.nome || "").toLowerCase().includes(searchTerm));

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
      row.innerHTML = `<td data-label="Nome">${item.nome}</td><td data-label="Qtd. em Estoque">${(item.qtd || 0).toFixed(3)}</td><td data-label="Estoque Mínimo">${(item.estoqueMinimo || 0).toFixed(3)}</td><td data-label="Custo (p/ Unidade)" class="admin-only">${formatCurrency(item.custo)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editIngrediente('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="window.removeIngrediente('${item.id}')">Remover</button></td>`;
    });
    updateSortHeaders("tabela-ingredientes", column, direction);
  };

  document.getElementById("form-ingrediente")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoader();
    const id = document.getElementById("ingrediente-id").value;
    const newIngrediente = {
      nome: document.getElementById("ingrediente-nome").value,
      qtd: parseFloat(document.getElementById("ingrediente-qtd").value) || 0,
      custo: parseFloat(document.getElementById("ingrediente-custo").value) || 0,
      estoqueMinimo: parseFloat(document.getElementById("ingrediente-estoque-minimo").value) || 0,
    };

    let error;
    if (id) {
      ({ error } = await supabaseClient.from("ingredientes").update(newIngrediente).eq("id", id));
    } else {
      ({ error } = await supabaseClient.from("ingredientes").insert(newIngrediente));
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
    const estoqueAtual = Number(item.qtd || 0);
    const estoqueMinimo = Number(item.estoqueMinimo || 0);
    const comprar = Math.max(0, estoqueMinimo - estoqueAtual);
    const formHTML = `
      <form id="edit-ingrediente-form" class="edit-form">
        <div class="edit-kpis">
          <div><span>Estoque atual</span><b>${estoqueAtual.toFixed(3)}</b></div>
          <div><span>Mínimo</span><b>${estoqueMinimo.toFixed(3)}</b></div>
          <div><span>Sugestão compra</span><b>${comprar.toFixed(3)}</b></div>
          <div><span>Custo un.</span><b>${formatCurrency(item.custo)}</b></div>
        </div>
        <div class="edit-section">
          <div class="edit-section-title"><span>Ingrediente</span><small>Todos os campos do cadastro</small></div>
          <div class="edit-grid two">
            <label>Nome
              <input type="text" name="nome" value="${escapeAttr(item.nome)}" required>
            </label>
            <label>Quantidade em estoque
              <input type="number" name="qtd" value="${safeNumber(item.qtd).toFixed(3)}" step="0.001" min="0" required>
            </label>
            <label>Custo por unidade
              <input type="number" name="custo" value="${safeNumber(item.custo).toFixed(2)}" step="0.01" min="0" required>
            </label>
            <label>Estoque mínimo
              <input type="number" name="estoqueMinimo" value="${safeNumber(item.estoqueMinimo).toFixed(3)}" step="0.001" min="0" required>
            </label>
          </div>
        </div>
        <div class="edit-actions">
          <button type="button" class="secondary-btn" onclick="closeModal('edit-modal')">Cancelar</button>
          <button type="submit">Salvar ingrediente</button>
        </div>
      </form>
    `;
    openModal("edit-modal", `Editar ingrediente · ${item.nome || ""}`, formHTML, () => {
      document.getElementById("edit-ingrediente-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const updatedData = {
          nome: String(formData.get("nome") || "").trim(),
          qtd: safeNumber(formData.get("qtd")),
          custo: safeNumber(formData.get("custo")),
          estoqueMinimo: safeNumber(formData.get("estoqueMinimo")),
        };
        showLoader();
        const { error } = await supabaseClient.from("ingredientes").update(updatedData).eq("id", id);
        hideLoader();
        if (error) {
          showSaveStatus("Erro ao atualizar: " + error.message, false);
        } else {
          showSaveStatus("Ingrediente salvo!");
          closeModal("edit-modal");
          await loadDataFromSupabase();
        }
      };
    });
  };

  window.removeIngrediente = async (id) => {
    if (confirm("Remover este ingrediente?")) {
      showLoader();
      const { error } = await supabaseClient.from("ingredientes").delete().eq("id", id);
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao remover: " + error.message, false);
      } else {
        await loadDataFromSupabase();
      }
    }
  };

  document.getElementById("search-ingredientes")?.addEventListener("input", renderIngredientes);

  const renderEstoque = () => {
    const tbody = document.getElementById("tabela-estoque")?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document.getElementById("search-estoque").value.toLowerCase();
    let filteredData = database.estoque.filter((item) => (item.nome || "").toLowerCase().includes(searchTerm));

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
      const lojaTag = item.visivel_loja === false
        ? '<span class="payment-tag unpaid">Oculto</span>'
        : '<span class="payment-tag paid">Visível</span>';
      const imgTag = item.imagem_url ? '<span class="payment-tag info">Imagem</span>' : '';
      row.innerHTML = `<td data-label="Sabor da Pizza">${escapeHTML(item.nome)}</td><td data-label="Tamanho">${escapeHTML(item.tamanho || "N/A")}</td><td data-label="Qtd.">${item.qtd}</td><td data-label="Custo Produção" class="admin-only">${formatCurrency(custo)}</td><td data-label="Preço Venda">${formatCurrency(item.precoVenda)}</td><td data-label="Loja">${lojaTag}${imgTag}<small class="shop-meta-preview">${escapeHTML(item.categoria_loja || "Pizzas")}</small></td><td data-label="Lucro Bruto" class="admin-only" style="color:${lucro >= 0 ? "green" : "red"};font-weight:bold;">${formatCurrency(lucro)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editEstoque('${item.id}')">Editar</button><button class="action-btn remove-btn" onclick="window.removeEstoque('${item.id}')">Remover</button></td>`;
    });
    updateSortHeaders("tabela-estoque", column, direction);
  };

  document.getElementById("form-estoque")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoader();
    const id = document.getElementById("estoque-id").value;
    const pizzaData = {
      nome: document.getElementById("estoque-nome").value,
      tamanho: document.getElementById("estoque-tamanho").value,
      qtd: parseInt(document.getElementById("estoque-qtd").value) || 0,
      precoVenda: parseFloat(document.getElementById("estoque-preco-venda").value) || 0,
      visivel_loja: true,
      categoria_loja: "Pizzas",
      descricao_loja: "",
      imagem_url: "",
      destaque_loja: false,
      ordem_loja: 1000,
      permitir_encomenda: true,
    };

    let error;
    if (id) {
      ({ error } = await supabaseClient.from("estoque").update(pizzaData).eq("id", id));
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
    const custo = calculatePizzaCost(item.id);
    const lucro = safeNumber(item.precoVenda) - custo;
    const formHTML = `
      <form id="edit-estoque-form" class="edit-form">
        <div class="edit-kpis">
          <div><span>Custo receita</span><b>${formatCurrency(custo)}</b></div>
          <div><span>Preço venda</span><b id="edit-pizza-preco-preview">${formatCurrency(item.precoVenda)}</b></div>
          <div><span>Lucro un.</span><b id="edit-pizza-lucro-preview">${formatCurrency(lucro)}</b></div>
          <div><span>Estoque</span><b>${Number(item.qtd || 0)}</b></div>
        </div>
        <div class="edit-section">
          <div class="edit-section-title"><span>Pizza pronta</span><small>Cardápio, preço e estoque</small></div>
          <div class="edit-grid two">
            <label>Sabor da pizza
              <input type="text" name="nome" value="${escapeAttr(item.nome)}" required>
            </label>
            <label>Tamanho
              <select name="tamanho" required>
                <option value="P" ${item.tamanho === "P" ? "selected" : ""}>Pequena</option>
                <option value="G" ${item.tamanho === "G" ? "selected" : ""}>Grande</option>
              </select>
            </label>
            <label>Quantidade em estoque
              <input type="number" name="qtd" value="${parseInt(item.qtd || 0)}" step="1" min="-999" required>
            </label>
            <label>Preço de venda
              <input type="number" name="precoVenda" value="${safeNumber(item.precoVenda).toFixed(2)}" step="0.01" min="0" required>
            </label>
          </div>
          <p class="edit-note">O custo vem da receita cadastrada. Alterar preço ou estoque aqui não altera ingredientes.</p>
        </div>
        <div class="edit-section">
          <div class="edit-section-title"><span>Loja online</span><small>O que o cliente vê no site</small></div>
          <div class="edit-grid two">
            <label>Categoria
              <input type="text" name="categoria_loja" value="${escapeAttr(item.categoria_loja || "Pizzas")}" placeholder="Pizzas, Especiais, Promoções">
            </label>
            <label>Ordem no cardápio
              <input type="number" name="ordem_loja" value="${parseInt(item.ordem_loja || 1000)}" step="1" min="0">
            </label>
            <label class="edit-wide">Descrição curta
              <textarea name="descricao_loja" rows="3" maxlength="240" placeholder="Ex.: Molho artesanal, queijo e calabresa.">${escapeHTML(item.descricao_loja || "")}</textarea>
            </label>
            <label class="edit-wide">Imagem do produto (URL)
              <input type="url" name="imagem_url" value="${escapeAttr(item.imagem_url || "")}" placeholder="https://...">
            </label>
          </div>
          <div class="edit-grid two loja-checks">
            <label class="check-row"><input type="checkbox" name="visivel_loja" ${item.visivel_loja === false ? "" : "checked"}> <span>Mostrar este sabor na loja</span></label>
            <label class="check-row"><input type="checkbox" name="permitir_encomenda" ${item.permitir_encomenda === false ? "" : "checked"}> <span>Permitir encomenda sem estoque</span></label>
            <label class="check-row"><input type="checkbox" name="destaque_loja" ${item.destaque_loja ? "checked" : ""}> <span>Destacar no topo do cardápio</span></label>
          </div>
          <p class="edit-note">Sabores ocultos não aparecem na loja.</p>
        </div>
        <div class="edit-actions">
          <button type="button" class="secondary-btn" onclick="closeModal('edit-modal')">Cancelar</button>
          <button type="submit">Salvar pizza</button>
        </div>
      </form>
    `;
    openModal("edit-modal", `Editar pizza · ${item.nome || ""}`, formHTML, () => {
      const precoInput = document.querySelector("#edit-estoque-form [name='precoVenda']");
      const updatePreview = () => {
        const preco = safeNumber(precoInput?.value);
        const lucroEl = document.getElementById("edit-pizza-lucro-preview");
        const precoEl = document.getElementById("edit-pizza-preco-preview");
        if (precoEl) precoEl.textContent = formatCurrency(preco);
        if (lucroEl) {
          lucroEl.textContent = formatCurrency(preco - custo);
          lucroEl.classList.toggle("negative", preco - custo < 0);
        }
      };
      precoInput?.addEventListener("input", updatePreview);
      updatePreview();

      document.getElementById("edit-estoque-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const updatedData = {
          nome: String(formData.get("nome") || "").trim(),
          tamanho: formData.get("tamanho"),
          qtd: parseInt(formData.get("qtd")) || 0,
          precoVenda: safeNumber(formData.get("precoVenda")),
          visivel_loja: formData.get("visivel_loja") === "on",
          categoria_loja: String(formData.get("categoria_loja") || "Pizzas").trim() || "Pizzas",
          descricao_loja: String(formData.get("descricao_loja") || "").trim().slice(0, 240),
          imagem_url: String(formData.get("imagem_url") || "").trim(),
          destaque_loja: formData.get("destaque_loja") === "on",
          ordem_loja: parseInt(formData.get("ordem_loja")) || 1000,
          permitir_encomenda: formData.get("permitir_encomenda") === "on",
        };
        showLoader();
        const { error } = await supabaseClient.from("estoque").update(updatedData).eq("id", id);
        hideLoader();
        if (error) {
          showSaveStatus("Erro ao atualizar: " + error.message, false);
        } else {
          showSaveStatus("Pizza salva!");
          closeModal("edit-modal");
          await loadDataFromSupabase();
        }
      };
    });
  };

  window.removeEstoque = async (id) => {
    if (confirm("Remover esta pizza? Isso também removerá receitas associadas.")) {
      showLoader();
      const { error } = await supabaseClient.from("estoque").delete().eq("id", id);
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao remover pizza: " + error.message, false);
      } else {
        await loadDataFromSupabase();
      }
    }
  };

  document.getElementById("search-estoque")?.addEventListener("input", renderEstoque);

  const renderReceitaIngredientesList = () => {
    const container = document.getElementById("receita-ingredientes-list");
    if (!container) return;
    container.innerHTML = "";
    if (receitaAtualIngredientes) {
      receitaAtualIngredientes.forEach((item, index) => {
        const ingrediente = database.ingredientes.find((i) => i.id === item.ingredienteId);
        container.innerHTML += `<div class="receita-ingrediente-item"><p><span>${(item.qtd || 0).toFixed(3)} x</span> ${ingrediente ? ingrediente.nome : "Ingrediente removido"}</p><button type="button" class="btn-remove-item" onclick="window.removeIngredienteDaReceita(${index})">X</button></div>`;
      });
    }
  };

  const renderReceitas = () => {
    const tbody = document.getElementById("tabela-receitas")?.querySelector("tbody");
    if (!tbody) return;
    const searchTerm = document.getElementById("search-receitas").value.toLowerCase();
    tbody.innerHTML = "";
    const filteredData = database.receitas.filter((receita) => {
      const pizza = database.estoque.find((p) => p.id === receita.pizzaId);
      if (!pizza) return false;
      const nomePizza = `${pizza.nome} (${pizza.tamanho || ""})`.toLowerCase();
      return nomePizza.includes(searchTerm);
    });

    filteredData.forEach((receita) => {
      const pizza = database.estoque.find((p) => p.id === receita.pizzaId);
      if (!pizza) return;
      const ingredientesList = receita.ingredientes?.map((item) => {
        const ingrediente = database.ingredientes.find((i) => i.id === item.ingredienteId);
        return ingrediente ? `${(item.qtd || 0).toFixed(3)} de ${ingrediente.nome}` : "item inválido";
      }).join(", ") || "Sem ingredientes";
      const custoTotal = calculatePizzaCost(pizza.id);
      const row = tbody.insertRow();
      row.innerHTML = `<td data-label="Pizza">${pizza.nome} (${pizza.tamanho || ""})</td><td data-label="Ingredientes"><small>${ingredientesList}</small></td><td data-label="Custo Total" class="admin-only">${formatCurrency(custoTotal)}</td><td data-label="Ações"><button class="action-btn edit-btn" onclick="window.editReceita('${receita.pizzaId}')">Editar</button><button class="action-btn remove-btn" onclick="window.removeReceita('${receita.pizzaId}')">Remover</button></td>`;
    });
  };

  document.getElementById("receita-pizza-select")?.addEventListener("change", (e) => {
    const pizzaId = e.target.value;
    const receitaExistente = database.receitas.find((r) => r.pizzaId === pizzaId);
    receitaAtualIngredientes = receitaExistente ? [...(receitaExistente.ingredientes || [])] : [];
    renderReceitaIngredientesList();
  });

  document.getElementById("btn-add-ingrediente-receita")?.addEventListener("click", () => {
    const ingredienteId = document.getElementById("receita-ingrediente-select").value;
    const qtd = parseFloat(document.getElementById("receita-ingrediente-qtd").value);
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

  document.getElementById("btn-salvar-receita")?.addEventListener("click", async () => {
    const pizzaId = document.getElementById("receita-pizza-select").value;
    if (!pizzaId) {
      alert("Selecione uma pizza para salvar a receita.");
      return;
    }
    showLoader();
    const receitaData = { pizzaId, ingredientes: [...receitaAtualIngredientes] };
    const { error } = await supabaseClient.from("receitas").upsert(receitaData, { onConflict: "pizzaId" });
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
    const receita = database.receitas.find((r) => r.pizzaId === pizzaId) || { pizzaId, ingredientes: [] };
    let editIngredientes = JSON.parse(JSON.stringify(receita.ingredientes || []));

    const pizzaOptions = database.estoque.map((p) => {
      const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
      return `<option value="${escapeAttr(p.id)}" ${p.id === receita.pizzaId ? "selected" : ""}>${escapeHTML(label)}</option>`;
    }).join("");

    const ingredienteOptions = (selectedId = "") => database.ingredientes.map((i) =>
      `<option value="${escapeAttr(i.id)}" ${i.id === selectedId ? "selected" : ""}>${escapeHTML(i.nome)}</option>`
    ).join("");

    const renderEditList = () => {
      const container = document.getElementById("edit-receita-list");
      const totalEl = document.getElementById("edit-receita-custo");
      if (!container) return;
      if (!editIngredientes.length) {
        container.innerHTML = `<p class="empty-state compact">Nenhum ingrediente nesta receita.</p>`;
      } else {
        container.innerHTML = editIngredientes.map((item, index) => `
          <div class="edit-line-item recipe-line">
            <label>Ingrediente
              <select onchange="window.updateEditReceitaIngrediente(${index}, 'ingredienteId', this.value)">
                <option value="">Selecione...</option>${ingredienteOptions(item.ingredienteId)}
              </select>
            </label>
            <label>Quantidade
              <input type="number" value="${safeNumber(item.qtd).toFixed(3)}" step="0.001" min="0" onchange="window.updateEditReceitaIngrediente(${index}, 'qtd', this.value)">
            </label>
            <button type="button" class="icon-danger" onclick="window.removeEditReceitaIngrediente(${index})">Remover</button>
          </div>
        `).join("");
      }
      const custo = editIngredientes.reduce((total, item) => {
        const ingrediente = database.ingredientes.find((i) => i.id === item.ingredienteId);
        return total + (ingrediente ? Number(ingrediente.custo || 0) * Number(item.qtd || 0) : 0);
      }, 0);
      if (totalEl) totalEl.textContent = formatCurrency(custo);
    };

    const formHTML = `
      <form id="edit-receita-form" class="edit-form">
        <div class="edit-kpis">
          <div><span>Ingredientes</span><b id="edit-receita-count">${editIngredientes.length}</b></div>
          <div><span>Custo calculado</span><b id="edit-receita-custo">R$ 0,00</b></div>
        </div>
        <div class="edit-section">
          <div class="edit-section-title"><span>Receita</span><small>Pizza e ingredientes usados</small></div>
          <div class="edit-grid one">
            <label>Pizza vinculada
              <select name="pizzaId" required>
                <option value="">Selecione a pizza...</option>${pizzaOptions}
              </select>
            </label>
          </div>
        </div>
        <div class="edit-section">
          <div class="edit-section-title"><span>Ingredientes</span><small>Edite, adicione ou remova itens</small></div>
          <div class="edit-add-row">
            <select id="edit-receita-add-ingrediente"><option value="">Ingrediente...</option>${ingredienteOptions()}</select>
            <input type="number" id="edit-receita-add-qtd" placeholder="Qtd" step="0.001" min="0">
            <button type="button" id="btn-edit-receita-add">Adicionar</button>
          </div>
          <div id="edit-receita-list" class="edit-list"></div>
        </div>
        <div class="edit-actions">
          <button type="button" class="secondary-btn" onclick="closeModal('edit-modal')">Cancelar</button>
          <button type="submit">Salvar receita</button>
        </div>
      </form>
    `;

    openModal("edit-modal", "Editar receita", formHTML, () => {
      window.updateEditReceitaIngrediente = (index, field, value) => {
        if (!editIngredientes[index]) return;
        editIngredientes[index][field] = field === "qtd" ? safeNumber(value) : value;
        renderEditList();
      };
      window.removeEditReceitaIngrediente = (index) => {
        editIngredientes.splice(index, 1);
        renderEditList();
      };
      document.getElementById("btn-edit-receita-add")?.addEventListener("click", () => {
        const ingredienteId = document.getElementById("edit-receita-add-ingrediente")?.value;
        const qtd = safeNumber(document.getElementById("edit-receita-add-qtd")?.value);
        if (!ingredienteId || qtd <= 0) return alert("Selecione um ingrediente e uma quantidade válida.");
        editIngredientes.push({ ingredienteId, qtd });
        document.getElementById("edit-receita-add-ingrediente").value = "";
        document.getElementById("edit-receita-add-qtd").value = "";
        renderEditList();
      });
      renderEditList();
      document.getElementById("edit-receita-form").onsubmit = async (e) => {
        e.preventDefault();
        const pizzaSelecionada = new FormData(e.target).get("pizzaId");
        if (!pizzaSelecionada) return alert("Selecione a pizza da receita.");
        showLoader();
        try {
          if (pizzaSelecionada !== pizzaId) {
            await supabaseClient.from("receitas").delete().eq("pizzaId", pizzaId);
          }
          const { error } = await supabaseClient.from("receitas").upsert(
            { pizzaId: pizzaSelecionada, ingredientes: editIngredientes },
            { onConflict: "pizzaId" }
          );
          if (error) throw error;
          showSaveStatus("Receita salva!");
          closeModal("edit-modal");
          await loadDataFromSupabase();
        } catch (error) {
          showSaveStatus("Erro ao salvar receita: " + error.message, false);
        } finally {
          hideLoader();
        }
      };
    });
  };

  window.removeReceita = async (pizzaId) => {
    if (confirm("Tem certeza que deseja remover esta receita?")) {
      showLoader();
      const { error } = await supabaseClient.from("receitas").delete().eq("pizzaId", pizzaId);
      hideLoader();
      if (error) {
        showSaveStatus("Erro ao remover receita: " + error.message, false);
      } else {
        await loadDataFromSupabase();
      }
    }
  };
  document.getElementById("search-receitas")?.addEventListener("input", renderReceitas);

  window.openEditPedidoModal = (id) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    if (!pedido) return;

    pedidoEditItems = JSON.parse(JSON.stringify(pedido.items || []));

    const clientesOptions = database.clientes.map((c) => `<option value="${escapeAttr(c.nome || "")}">`).join("");
    const pizzaOptions = database.estoque.map((p) => {
      const label = p.tamanho ? `${p.nome} (${p.tamanho})` : p.nome;
      const sobra = getPizzaSobraForWeek(p.id, pedido.dataEntrega ? getWeekStart(pedido.dataEntrega) : getWeekStart());
      return `<option value="${escapeAttr(p.id)}">${escapeHTML(label)} · Estoque ${p.qtd || 0} · Sobra ${sobra}</option>`;
    }).join("");
    const dataEntrega = pedido.dataEntrega ? formatDateToYYYYMMDD(pedido.dataEntrega) : getWeekStart();
    const valorAtual = safeNumber(pedido.valorFinal || pedido.valorTotal);

    const formHTML = `
      <form id="edit-pedido-form" class="edit-form edit-order-form">
        <input type="hidden" name="id" value="${escapeAttr(pedido.id)}">
        <datalist id="edit-clientes-list">${clientesOptions}</datalist>

        <div class="edit-kpis">
          <div><span>Total atual</span><b>${formatCurrency(valorAtual)}</b></div>
          <div><span>Status</span><b>${escapeHTML(pedido.status || "Pendente")}</b></div>
          <div><span>Pagamento</span><b>${escapeHTML(pedido.pagamento || "N/A")}</b></div>
          <div><span>Pago?</span><b>${isPedidoPago(pedido) ? "Sim" : "Não"}</b></div>
        </div>

        <div class="edit-section">
          <div class="edit-section-title"><span>Dados do pedido</span><small>Cliente, entrega e pagamento</small></div>
          <div class="edit-grid three">
            <label>Cliente
              <input type="text" name="cliente" value="${escapeAttr(pedido.cliente || "")}" list="edit-clientes-list" required>
            </label>
            <label>Telefone
              <input type="text" name="telefone" value="${escapeAttr(pedido.telefone || "")}">
            </label>
            <label>Cidade
              <input type="text" name="cidade" value="${escapeAttr(pedido.cidade || "")}" required>
            </label>
            <label>Endereço
              <input type="text" name="endereco" value="${escapeAttr(pedido.endereco || "")}">
            </label>
            <label>Vendedor
              <input type="text" name="vendedor" value="${escapeAttr(pedido.vendedor || "")}" required>
            </label>
            <label>Semana/data entrega
              <input type="date" name="dataEntrega" value="${escapeAttr(dataEntrega)}" required>
            </label>
            <label>Forma de pagamento
              <select name="pagamento" id="edit-pedido-pagamento" required>
                <option value="Dinheiro" ${pedido.pagamento === "Dinheiro" ? "selected" : ""}>Dinheiro</option>
                <option value="Pix" ${pedido.pagamento === "Pix" ? "selected" : ""}>Pix</option>
                <option value="Cartão de Débito" ${pedido.pagamento === "Cartão de Débito" ? "selected" : ""}>Cartão de Débito</option>
                <option value="Cartão de Crédito" ${pedido.pagamento === "Cartão de Crédito" ? "selected" : ""}>Cartão de Crédito</option>
              </select>
            </label>
            <label>Status
              <select name="status" required>
                <option value="Pendente" ${pedido.status === "Pendente" ? "selected" : ""}>Aguardando confirmação</option>
                <option value="Confirmado" ${pedido.status === "Confirmado" ? "selected" : ""}>Confirmado</option>
                <option value="Pronto" ${pedido.status === "Pronto" ? "selected" : ""}>Pronto</option>
                <option value="Concluído" ${pedido.status === "Concluído" ? "selected" : ""}>Concluído</option>
                <option value="Cancelado" ${pedido.status === "Cancelado" ? "selected" : ""}>Cancelado</option>
                <option value="Negado" ${pedido.status === "Negado" ? "selected" : ""}>Negado</option>
              </select>
            </label>
            <label>Desconto rápido
              <input type="text" id="edit-pedido-desconto" inputmode="decimal" placeholder="0%">
            </label>
          </div>
          <label class="toggle-line">
            <input type="checkbox" name="pago" ${isPedidoPago(pedido) ? "checked" : ""}> Pedido pago
          </label>
        </div>

        <div class="edit-section">
          <div class="edit-section-title"><span>Itens</span><small>Edite quantidade, preço e nome dos itens</small></div>
          <div class="edit-add-row">
            <select id="edit-item-pizza"><option value="">Adicionar pizza do estoque...</option>${pizzaOptions}</select>
            <input type="number" id="edit-item-qtd" placeholder="Qtd" value="1" min="1">
            <button type="button" id="btn-add-item-edit-pedido">Adicionar</button>
          </div>
          <div class="edit-add-row custom-row">
            <input type="text" id="edit-custom-name" placeholder="Pizza personalizada">
            <select id="edit-custom-size"><option value="P">P</option><option value="G">G</option></select>
            <input type="number" id="edit-custom-qtd" placeholder="Qtd" value="1" min="1">
            <input type="number" id="edit-custom-price" placeholder="Preço un." step="0.01" min="0">
            <button type="button" id="btn-add-custom-edit-pedido" class="secondary-btn">Adicionar outro</button>
          </div>
          <div id="edit-pedido-itens-carrinho" class="edit-list"></div>
          <button type="button" id="btn-recalcular-precos-edit" class="secondary-btn inline-action">Recalcular preços pelo pagamento</button>
        </div>

        <div class="edit-section">
          <div class="edit-section-title"><span>Valores e observações</span><small>Total final pode ser ajustado manualmente</small></div>
          <div class="edit-grid two">
            <label>Total calculado
              <input type="text" id="total-calculado-edit-pedido" value="R$ 0,00" readonly>
            </label>
            <label>Valor final
              <input type="number" id="valor-final-edit-pedido" step="0.01" value="${valorAtual.toFixed(2)}">
            </label>
          </div>
          <label>Observações
            <textarea name="observacoes" rows="3" placeholder="Ex.: sem cebola, retirar na loja, combinar entrega...">${escapeHTML(pedido.observacoes || "")}</textarea>
          </label>
        </div>

        <div class="edit-actions">
          <button type="button" class="secondary-btn" onclick="closeModal('edit-modal')">Cancelar</button>
          <button type="submit">Salvar pedido</button>
        </div>
      </form>
    `;

    openModal("edit-modal", `Editar pedido · ${pedido.cliente || ""}`, formHTML, () => {
      const pagamentoSelect = document.getElementById("edit-pedido-pagamento");
      const descontoInput = document.getElementById("edit-pedido-desconto");

      renderEditPedidoCarrinho();
      updateTotalEditPedido();

      pagamentoSelect?.addEventListener("change", () => {
        document.getElementById("edit-custom-price").placeholder = pagamentoSelect.value === "Dinheiro" ? "35 ou 25" : "38 ou 28";
      });
      descontoInput?.addEventListener("input", updateTotalEditPedido);
      descontoInput?.addEventListener("blur", (e) => {
        formatPercentField(e.target);
        updateTotalEditPedido();
      });

      document.getElementById("btn-add-item-edit-pedido")?.addEventListener("click", () => {
        const pizzaSelect = document.getElementById("edit-item-pizza");
        const pizzaId = pizzaSelect.value;
        const qtd = parseInt(document.getElementById("edit-item-qtd").value) || 1;
        if (!pizzaId || qtd < 1) return;

        const pizzaData = database.estoque.find((p) => p.id === pizzaId);
        if (!pizzaData) return;
        pedidoEditItems.push({
          pizzaId,
          pizzaNome: pizzaData.tamanho ? `${pizzaData.nome} (${pizzaData.tamanho})` : pizzaData.nome,
          qtd,
          isCustom: false,
          preco: getPrecoPorPagamento(pizzaData.precoVenda, pagamentoSelect?.value),
        });

        renderEditPedidoCarrinho();
        updateTotalEditPedido();
        pizzaSelect.value = "";
        document.getElementById("edit-item-qtd").value = "1";
      });

      document.getElementById("btn-add-custom-edit-pedido")?.addEventListener("click", () => {
        const nome = document.getElementById("edit-custom-name")?.value.trim();
        const tamanho = document.getElementById("edit-custom-size")?.value || "P";
        const qtd = parseInt(document.getElementById("edit-custom-qtd")?.value) || 1;
        const defaultPrice = getPrecoPorPagamento(tamanho === "G" ? 38 : 28, pagamentoSelect?.value);
        const preco = safeNumber(document.getElementById("edit-custom-price")?.value, defaultPrice);
        if (!nome || qtd < 1) return alert("Informe o nome da pizza personalizada e a quantidade.");
        pedidoEditItems.push({ pizzaId: "outro", pizzaNome: `${nome} (${tamanho})`, qtd, isCustom: true, preco });
        document.getElementById("edit-custom-name").value = "";
        document.getElementById("edit-custom-qtd").value = "1";
        document.getElementById("edit-custom-price").value = "";
        renderEditPedidoCarrinho();
        updateTotalEditPedido();
      });

      document.getElementById("btn-recalcular-precos-edit")?.addEventListener("click", () => {
        const pagamento = pagamentoSelect?.value || "";
        pedidoEditItems = pedidoEditItems.map((item) => {
          if (item.isCustom) return item;
          const pizza = database.estoque.find((p) => p.id === item.pizzaId);
          return pizza ? { ...item, preco: getPrecoPorPagamento(pizza.precoVenda, pagamento) } : item;
        });
        renderEditPedidoCarrinho();
        updateTotalEditPedido();
      });

      document.getElementById("edit-pedido-form").onsubmit = async (e) => {
        e.preventDefault();
        await handleUpdatePedido(pedido);
      };
    });
  };

  const renderEditPedidoCarrinho = () => {
    const container = document.getElementById("edit-pedido-itens-carrinho");
    if (!container) return;
    if (!pedidoEditItems.length) {
      container.innerHTML = '<p class="empty-state compact">Nenhuma pizza adicionada.</p>';
      return;
    }
    container.innerHTML = pedidoEditItems.map((item, index) => `
      <div class="edit-line-item order-line">
        <label>Item
          <input type="text" value="${escapeAttr(item.pizzaNome || "")}" onchange="window.updateEditItemField(${index}, 'pizzaNome', this.value)">
        </label>
        <label>Qtd
          <input type="number" value="${Number(item.qtd || 1)}" min="1" onchange="window.updateEditItemField(${index}, 'qtd', this.value)">
        </label>
        <label>Preço un.
          <input type="number" value="${safeNumber(item.preco).toFixed(2)}" step="0.01" min="0" onchange="window.updateEditItemField(${index}, 'preco', this.value)">
        </label>
        <label class="toggle-mini"><input type="checkbox" ${item.isCustom ? "checked" : ""} onchange="window.updateEditItemField(${index}, 'isCustom', this.checked)"> Outro</label>
        <button type="button" class="icon-danger" onclick="window.removeEditItemPedido(${index})">Remover</button>
      </div>
    `).join("");
  };

  window.updateEditItemField = (index, field, value) => {
    if (!pedidoEditItems[index]) return;
    if (field === "qtd") pedidoEditItems[index][field] = Math.max(1, parseInt(value) || 1);
    else if (field === "preco") pedidoEditItems[index][field] = safeNumber(value);
    else if (field === "isCustom") pedidoEditItems[index][field] = Boolean(value);
    else pedidoEditItems[index][field] = value;
    updateTotalEditPedido();
  };

  window.removeEditItemPedido = (index) => {
    pedidoEditItems.splice(index, 1);
    renderEditPedidoCarrinho();
    updateTotalEditPedido();
  };

  const updateTotalEditPedido = () => {
    const totalBruto = pedidoEditItems.reduce((acc, item) => acc + safeNumber(item.preco) * Number(item.qtd || 0), 0);
    const desconto = parsePercent(document.getElementById("edit-pedido-desconto")?.value);
    const total = applyDiscount(totalBruto, desconto);
    const totalEl = document.getElementById("total-calculado-edit-pedido");
    if (totalEl) totalEl.value = formatCurrency(total);
    const valorFinalInput = document.getElementById("valor-final-edit-pedido");
    if (valorFinalInput && (!valorFinalInput.dataset.userEdited || document.activeElement !== valorFinalInput)) {
      valorFinalInput.value = total.toFixed(2);
    }
    if (valorFinalInput && !valorFinalInput.dataset.listenerAttached) {
      valorFinalInput.addEventListener("input", () => valorFinalInput.dataset.userEdited = "true");
      valorFinalInput.dataset.listenerAttached = "true";
    }
  };

  const handleUpdatePedido = async (originalPedido) => {
    if (pedidoEditItems.length === 0) {
      alert("O pedido precisa ter pelo menos uma pizza.");
      return;
    }

    showLoader();
    const form = document.getElementById("edit-pedido-form");
    const formData = new FormData(form);
    const valorFinalInput = form.querySelector("#valor-final-edit-pedido").value;
    const valorCalculado = pedidoEditItems.reduce((acc, item) => acc + safeNumber(item.preco) * Number(item.qtd || 0), 0);
    const valorFinal = safeNumber(valorFinalInput, valorCalculado);
    const clienteNome = String(formData.get("cliente") || "").trim();
    const cidade = String(formData.get("cidade") || "").trim();

    const updatedPedidoData = {
      cliente: clienteNome,
      telefone: String(formData.get("telefone") || "").trim(),
      cidade,
      endereco: String(formData.get("endereco") || "").trim(),
      vendedor: String(formData.get("vendedor") || "").trim(),
      pagamento: formData.get("pagamento"),
      dataEntrega: formData.get("dataEntrega"),
      status: formData.get("status"),
      pago: formData.get("status") === "Concluído" || formData.get("pago") === "on",
      observacoes: String(formData.get("observacoes") || "").trim(),
      items: pedidoEditItems,
      valorTotal: valorCalculado,
      valorFinal: valorFinal,
    };

    try {
      let cliente = database.clientes.find((c) =>
        (c.nome || "").toLowerCase() === clienteNome.toLowerCase() &&
        (c.cidade || "").toLowerCase() === cidade.toLowerCase()
      );
      if (!cliente && clienteNome && cidade) {
        const { data, error } = await supabaseClient.from("clientes").insert({
          nome: clienteNome,
          telefone: updatedPedidoData.telefone,
          cidade,
          endereco: updatedPedidoData.endereco,
        }).select().single();
        if (error) throw error;
        cliente = data;
      } else if (cliente) {
        await supabaseClient.from("clientes").update({
          telefone: updatedPedidoData.telefone || cliente.telefone,
          endereco: updatedPedidoData.endereco || cliente.endereco,
        }).eq("id", cliente.id);
      }
      if (cliente?.id) updatedPedidoData.clienteId = cliente.id;

      const originalSemanaInicio = originalPedido.dataEntrega ? getWeekStart(originalPedido.dataEntrega) : null;
      const semanaInicio = getWeekStart(updatedPedidoData.dataEntrega);
      const quotas = database.massas_semanais.find((m) => m.semana_inicio === semanaInicio) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
      const used = computeWeeklyUsage(semanaInicio);

      if (originalSemanaInicio === semanaInicio && orderHoldsStock(originalPedido.status)) {
        (originalPedido.items || []).forEach((item) => {
          if (item.isCustom) return;
          const pizza = database.estoque.find((e) => e.id === item.pizzaId);
          const doughType = mapPizzaToDough(pizza);
          if (doughType) used[doughType] -= Number(item.qtd || 0);
        });
      }

      const newOrderDoughs = { G: 0, P: 0, PC: 0 };
      updatedPedidoData.items.forEach((item) => {
        if (item.isCustom) return;
        const pizza = database.estoque.find((e) => e.id === item.pizzaId);
        const doughType = mapPizzaToDough(pizza);
        if (doughType) newOrderDoughs[doughType] += Number(item.qtd || 0);
      });

      const exceeds = [];
      if (used.G + newOrderDoughs.G > (quotas.g_semana || 0)) exceeds.push(`G: ${used.G + newOrderDoughs.G}/${quotas.g_semana || 0}`);
      if (used.P + newOrderDoughs.P > (quotas.p_semana || 0)) exceeds.push(`P: ${used.P + newOrderDoughs.P}/${quotas.p_semana || 0}`);
      if (used.PC + newOrderDoughs.PC > (quotas.pc_semana || 0)) exceeds.push(`P de Chocolate: ${used.PC + newOrderDoughs.PC}/${quotas.pc_semana || 0}`);
      if (exceeds.length > 0) throw new Error("Limite semanal de massas atingido para: " + exceeds.join(" | "));

      // Estoque agora é reconciliado pela RPC atualizar_pedido_seguro em uma única transação no banco.
      // Status Pendente pode ficar como encomenda/produção pendente sem reservar estoque.
      const { data: pedidoAtualizado, error: updateError } = await supabaseClient.rpc("atualizar_pedido_seguro", {
        p_pedido_id: originalPedido.id,
        p_pedido: updatedPedidoData,
      });
      if (updateError) throw updateError;

      showSaveStatus(pedidoAtualizado?.estoque_baixado ? "Pedido atualizado e estoque reservado." : "Pedido atualizado como encomenda/produção pendente.");
      closeModal("edit-modal");
      await loadDataFromSupabase();
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao atualizar pedido"), false);
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
        return ws === weekStart && orderHoldsStock(p.status) && p.estoque_baixado === false;
      })
      .forEach(p => {
        (p.items || []).forEach(item => {
          if (item.isCustom || !item.pizzaId) return;
          demand[item.pizzaId] = (demand[item.pizzaId] || 0) + Number(item.qtd || 0);
        });
      });
    return demand;
  };

  const getPizzaWeekStats = (weekStart = getWeekStart()) => {
    const demandByPizza = computePizzaDemandForWeek(weekStart);
    return database.estoque.map((pizza) => {
      const pedidosSemana = Number(demandByPizza[pizza.id] || 0);
      const estoqueAtual = Number(pizza.qtd || 0);
      const sobraProj = estoqueAtual - pedidosSemana;
      return { ...pizza, pedidosSemana, estoqueAtual, sobraProj };
    });
  };

  const getPizzaSobraForWeek = (pizzaId, weekStart = getWeekStart()) => {
    const demandByPizza = computePizzaDemandForWeek(weekStart);
    const pizza = database.estoque.find((p) => p.id === pizzaId);
    return Number(pizza?.qtd || 0) - Number(demandByPizza[pizzaId] || 0);
  };

  const formatStockSobra = (pizzaId, weekStart = getWeekStart()) => {
    const pizza = database.estoque.find((p) => p.id === pizzaId);
    const estoque = Number(pizza?.qtd || 0);
    const sobra = getPizzaSobraForWeek(pizzaId, weekStart);
    return `disp. ${Math.max(0, sobra)} · estoque ${estoque}`;
  };

  const generateSobrasMessage = (weekStart = getWeekStart()) => {
    const available = getPizzaWeekStats(weekStart)
      .filter((p) => Number(p.sobraProj || 0) > 0)
      .sort((a, b) => b.sobraProj - a.sobraProj || String(a.nome).localeCompare(String(b.nome)));

    if (available.length === 0) return "No momento não temos pizzas disponíveis para retirada imediata.";

    const lines = available.map((p) => `• ${p.nome} (${p.tamanho}) — ${p.sobraProj} un.`);
    return `Temos disponível para retirada:\n\n${lines.join("\n")}\n\nMe chama para reservar a sua 😊`;
  };

  const renderConsultaRapidaSobras = () => {
    const selectSemana = document.getElementById("sobras-semana-select");
    const searchInput = document.getElementById("sobras-search-pizza");
    if (!selectSemana) return;

    if (!selectSemana.dataset.ready) {
      populateWeekSelector(selectSemana, { futureOnly: true, futureWeeks: 4, setCurrentDefault: true, keepPlaceholder: false });
      selectSemana.dataset.ready = "true";
    }
    if (!selectSemana.value) selectSemana.value = getWeekStart();

    const refresh = () => {
      const weekStart = selectSemana.value || getWeekStart();
      const searchTerm = (searchInput?.value || "").toLowerCase();
      const quotas = database.massas_semanais.find((m) => m.semana_inicio === weekStart) || { g_semana: 0, p_semana: 0, pc_semana: 0 };
      const used = computeWeeklyUsage(weekStart, true);
      const tbodyM = document.querySelector("#tabela-sobras-massas tbody");
      if (tbodyM) {
        const rows = [
          ["G", quotas.g_semana || 0, used.G],
          ["P", quotas.p_semana || 0, used.P],
          ["P Chocolate", quotas.pc_semana || 0, used.PC],
        ];
        tbodyM.innerHTML = rows.map(([tipo, quota, usado]) => {
          const restante = Number(quota) - Number(usado);
          return `<tr class="${restante < 0 ? "low-stock" : ""}"><td>${tipo}</td><td>${quota}</td><td>${usado}</td><td><b>${restante}</b></td></tr>`;
        }).join("");
      }

      let pizzaData = getPizzaWeekStats(weekStart);
      if (searchTerm) pizzaData = pizzaData.filter((p) => `${p.nome} ${p.tamanho || ""}`.toLowerCase().includes(searchTerm));

      const disponiveis = pizzaData.filter((p) => p.sobraProj > 0).sort((a, b) => b.sobraProj - a.sobraProj || a.nome.localeCompare(b.nome));
      const faltando = pizzaData.filter((p) => p.sobraProj < 0).sort((a, b) => a.sobraProj - b.sobraProj || a.nome.localeCompare(b.nome));
      const zeradas = pizzaData.filter((p) => p.sobraProj === 0).sort((a, b) => a.nome.localeCompare(b.nome));

      const cardsBox = document.getElementById("sobras-cards");
      if (cardsBox) {
        const top = disponiveis.slice(0, 12);
        cardsBox.innerHTML = top.length
          ? top.map((p) => `<div class="sobra-card"><strong>${p.nome} <span>${p.tamanho}</span></strong><b>${p.sobraProj}</b><small>em estoque ${p.estoqueAtual} · pedidos ${p.pedidosSemana}</small></div>`).join("")
          : `<div class="empty-state compact">Nenhuma pizza sobrando para essa semana.</div>`;
      }

      const msg = document.getElementById("sobras-mensagem");
      if (msg) msg.value = generateSobrasMessage(weekStart);

      const tbodyP = document.querySelector("#tabela-sobras-pizzas tbody");
      if (tbodyP) {
        const ordered = [...faltando, ...disponiveis, ...zeradas];
        tbodyP.innerHTML = ordered.map((e) => {
          const state = e.sobraProj < 0 ? "low-stock" : e.sobraProj > 0 ? "has-surplus" : "";
          const tag = e.sobraProj < 0 ? "Produzir" : e.sobraProj > 0 ? "Sobrando" : "Zerado";
          return `<tr class="${state}">
            <td data-label="Pizza"><b>${e.nome} (${e.tamanho})</b><br><small>${tag}</small></td>
            <td data-label="Estoque">${e.estoqueAtual}</td>
            <td data-label="Pedidos">${e.pedidosSemana}</td>
            <td data-label="Sobra"><b>${e.sobraProj}</b></td>
          </tr>`;
        }).join("") || `<tr><td colspan="4">Nada encontrado.</td></tr>`;
      }
    };

    selectSemana.onchange = refresh;
    if (searchInput) searchInput.oninput = refresh;
    refresh();
  };

  window.copySobrasMensagem = async () => {
    const textarea = document.getElementById("sobras-mensagem");
    if (!textarea) return;
    try {
      await navigator.clipboard.writeText(textarea.value);
      showSaveStatus("Mensagem copiada!");
    } catch (error) {
      textarea.select();
      document.execCommand("copy");
      showSaveStatus("Mensagem copiada!");
    }
  };

  document.getElementById("btn-open-filter-modal")?.addEventListener("click", () => {
    const vendedorSelect = document.getElementById("filter-modal-vendedor");
    if (vendedorSelect) {
      const currentVal = vendedorSelect.value;
      const firstOption = vendedorSelect.options[0];
      vendedorSelect.innerHTML = "";
      if (firstOption) vendedorSelect.appendChild(firstOption);

      const vendedoresFromProfiles = (database.vendedores || []).map((v) => v.nome).filter(Boolean);
      const vendedoresFromOrders = database.pedidos.map(p => p.vendedor).filter(Boolean).map(vendedor => {
        const firstName = vendedor.trim().split(" ")[0];
        return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      });
      const vendedores = [...new Set([...vendedoresFromProfiles, ...vendedoresFromOrders])];
      vendedores.sort().forEach(v => {
        vendedorSelect.innerHTML += `<option value="${escapeAttr(v)}">${escapeHTML(v)}</option>`;
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
      semanaSelect.value = currentVal || getWeekStart();
    }

    if (!document.getElementById("filter-modal-status")?.value) {
      document.getElementById("filter-modal-status").value = "NaoProntos";
    }
    updateFilterUX();
    openModal('filter-modal', 'Filtrar Pedidos');
  });

  document.getElementById("filter-pedidos-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    renderPedidos();
    closeModal('filter-modal');
  });

  const updateFilterUX = () => {
    const statusValue = document.getElementById("filter-modal-status")?.value || "";
    document.querySelectorAll("#filter-status-chips button").forEach((btn) => btn.classList.toggle("active", btn.dataset.status === statusValue));
    const summary = document.getElementById("filter-active-summary");
    if (!summary) return;
    const parts = [];
    const cliente = document.getElementById("filter-modal-cliente")?.value;
    const cidade = document.getElementById("filter-modal-cidade")?.value;
    const vendedor = document.getElementById("filter-modal-vendedor")?.value;
    const semana = document.getElementById("filter-modal-semana")?.selectedOptions?.[0]?.textContent;
    const pagamento = document.getElementById("filter-modal-pagamento-status")?.value;
    const forma = document.getElementById("filter-modal-forma-pagamento")?.value;
    if (statusValue) {
      const statusLabels = {
        NaoProntos: "Não prontos",
        Pendente: "Aguardando confirmação",
        Confirmado: "Confirmados",
        Pronto: "Prontos",
        "Concluído": "Concluídos",
        Cancelado: "Cancelados",
        Negado: "Negados",
      };
      parts.push(`Status: ${statusLabels[statusValue] || statusValue}`);
    }
    if (cliente) parts.push(`Cliente: ${cliente}`);
    if (cidade) parts.push(`Cidade: ${cidade}`);
    if (vendedor) parts.push(`Vendedor: ${vendedor}`);
    if (semana && document.getElementById("filter-modal-semana")?.value) parts.push(semana);
    if (pagamento) parts.push(pagamento === "pago" ? "Pagos" : "Não pagos");
    if (forma) parts.push(`Pagamento: ${forma}`);
    summary.innerHTML = parts.length ? parts.map((p) => `<span>${escapeHTML(p)}</span>`).join("") : `<span>Nenhum filtro avançado além da busca rápida.</span>`;
  };

  document.querySelectorAll("#filter-status-chips button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("filter-modal-status").value = btn.dataset.status;
      updateFilterUX();
    });
  });
  document.querySelectorAll("#filter-pedidos-form input, #filter-pedidos-form select").forEach((el) => el.addEventListener("input", updateFilterUX));
  document.querySelectorAll("#filter-pedidos-form select").forEach((el) => el.addEventListener("change", updateFilterUX));

  const clearPedidoFilters = () => {
    document.getElementById("filter-pedidos-form").reset();
    document.getElementById("filter-modal-pagamento-status").value = "";
    document.getElementById("filter-modal-forma-pagamento").value = "";
    window.resetPedidoFilters?.();
  };

  document.getElementById("btn-clear-filters")?.addEventListener("click", clearPedidoFilters);
  document.getElementById("btn-clear-filters-top")?.addEventListener("click", clearPedidoFilters);

  const getFilteredPedidos = (filterRange = "all") => {
    const customWeek = document.getElementById("dash-week-filter")?.value;
    if (filterRange === "custom-week" && customWeek) {
      return database.pedidos.filter(p => {
        if (p.status !== "Concluído" && p.status !== "Pronto") return false;
        if (!p.dataEntrega) return false;
        return getWeekStart(p.dataEntrega) === customWeek;
      });
    }

    if (filterRange !== "custom-week") {
      const weekSelect = document.getElementById("dash-week-filter");
      if (weekSelect) weekSelect.value = "";
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return database.pedidos.filter((p) => {
      if (p.status !== "Concluído" && p.status !== "Pronto") return false;
      const pDate = new Date((p.dataEntrega || p.created_at) + "T00:00:00");
      switch (filterRange) {
        case "today": return pDate >= today;
        case "week": return pDate >= weekStart;
        case "month": return pDate >= monthStart;
        case "all":
        default: return true;
      }
    });
  };

  const renderDashboard = (filterRange = "all") => {
    Object.values(chartInstances).forEach((chart) => {
      if (chart && typeof chart.destroy === "function") chart.destroy();
    });

    const filteredPedidos = getFilteredPedidos(filterRange);

    renderBalancoChart(filteredPedidos);
    renderPizzasMaisLucrativasChart(filteredPedidos);
    renderVendasPorVendedorChart(filteredPedidos);
    renderPedidosSemanaChart(filteredPedidos);
    renderVendasPorDiaChart(filteredPedidos);
    renderPizzasMaisVendidasList(filteredPedidos);
    renderNovosClientesChart();
    renderPizzaRanking(filterRange);
    renderDashboardCompareCards(filteredPedidos);
  };

  const renderBalancoChart = (t) => {
    const e = t.reduce((acc, p) => acc + Number(p.valorFinal), 0);
    const a = t.reduce((acc, p) => {
      return acc + p.items.reduce((inner, item) => inner + (item.isCustom ? 0 : calculatePizzaCost(item.pizzaId) * item.qtd), 0);
    }, 0);
    const r = e - a;

    const canvas = document.getElementById("balancoChart");
    if (!canvas) return;

    if (chartInstances.balanco) chartInstances.balanco.destroy();
    chartInstances.balanco = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: ["Balanço"],
        datasets: [
          { label: "Receita", data: [e], backgroundColor: "#2ecc71" },
          { label: "Custo", data: [a], backgroundColor: "#e74c3c" },
          { label: "Lucro", data: [r], backgroundColor: "#3498db" }
        ]
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  };

  const renderPizzasMaisLucrativasChart = (t) => {
    const e = t.flatMap((t) => t.items).reduce((t, e) => {
      if (e.isCustom) return t;
      const a = calculatePizzaCost(e.pizzaId);
      const r = (e.preco - a) * e.qtd;
      return (t[e.pizzaNome] = (t[e.pizzaNome] || 0) + r), t;
    }, {});
    const a = Object.keys(e).sort((t, a) => e[a] - e[t]).slice(0, 10);
    const r = a.map((t) => e[t]);

    if (!document.getElementById("pizzasMaisLucrativasChart")) return;
    const o = document.getElementById("pizzasMaisLucrativasChart").getContext("2d");
    if (chartInstances.lucro) chartInstances.lucro.destroy();
    chartInstances.lucro = new Chart(o, {
      type: "doughnut",
      data: {
        labels: a,
        datasets: [{
          data: r,
          backgroundColor: ["#2ecc71", "#3498db", "#9b59b6", "#f1c40f", "#e67e22", "#1abc9c"],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10 } },
          tooltip: { callbacks: { label: (t) => `${t.label}: ${formatCurrency(t.raw)}` } },
        },
      },
    });
  };

  const renderVendasPorVendedorChart = (t) => {
    const e = t.reduce((t, e) => {
      if (e.vendedor) t[e.vendedor] = (t[e.vendedor] || 0) + Number(e.valorFinal);
      return t;
    }, {});
    const a = Object.keys(e).sort((t, a) => e[a] - e[t]);
    const r = a.map((t) => e[t]);

    if (!document.getElementById("vendasPorVendedorChart")) return;
    const o = document.getElementById("vendasPorVendedorChart").getContext("2d");
    if (chartInstances.vendedor) chartInstances.vendedor.destroy();
    chartInstances.vendedor = new Chart(o, {
      type: "bar",
      data: {
        labels: a,
        datasets: [{ label: "Total Vendido", data: r, backgroundColor: "#487eb0" }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: (t) => formatCurrency(t) } } },
      },
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
        const qty = (p.items || []).reduce((acc, it) => acc + Number(it.qtd || 0), 0);
        weeksMap[ws] += qty;
      }
    });
    const labels = Object.keys(weeksMap).sort().map((ws) => {
      const d = new Date(ws + "T00:00:00");
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    });
    const data = Object.values(weeksMap);
    const ctx = canvas.getContext("2d");
    if (chartInstances.semana) chartInstances.semana.destroy();
    chartInstances.semana = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Qtd de pizzas vendidas (semana)",
          data,
          tension: 0.3,
          fill: false,
          backgroundColor: "#1e272e",
          borderColor: "#e84118",
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  };

  const renderVendasPorDiaChart = (pedidos) => {
    const canvasElement = document.getElementById("vendasPorDiaChart");
    if (!canvasElement) return;
    const ctx = canvasElement.getContext("2d");
    const vendasPorDia = pedidos.reduce((acc, pedido) => {
      if (!pedido.dataEntrega) return acc;
      const dia = new Date(pedido.dataEntrega + "T00:00:00").toLocaleDateString("pt-BR");
      acc[dia] = (acc[dia] || 0) + Number(pedido.valorFinal);
      return acc;
    }, {});

    const labels = Object.keys(vendasPorDia).sort(
      (a, b) => new Date(a.split("/").reverse().join("-")) - new Date(b.split("/").reverse().join("-"))
    );
    const data = labels.map((label) => vendasPorDia[label]);

    if (chartInstances.dia) chartInstances.dia.destroy();
    chartInstances.dia = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Receita por Dia",
          data: data,
          borderColor: "#2c3e50",
          tension: 0.1,
          fill: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: (value) => formatCurrency(value) } } },
      },
    });
  };

  const renderPizzasMaisVendidasList = (pedidos) => {
    const container = document.getElementById("pizzas-mais-vendidas-list");
    if (!container) return;

    const contagem = pedidos
      .flatMap((p) => p.items || [])
      .reduce((acc, item) => {
        if (!item.isCustom && item.pizzaNome) {
          acc[item.pizzaNome] = (acc[item.pizzaNome] || 0) + Number(item.qtd || 0);
        }
        return acc;
      }, {});

    const ordenado = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]);

    container.innerHTML = "";
    if (ordenado.length === 0) {
      container.innerHTML = "<p style='color:#777; text-align:center;'>Nenhuma pizza vendida no período.</p>";
      return;
    }

    let html = "<ul class='spotify-ranking-list'>";
    ordenado.forEach((nome, index) => {
      html += `
                <li>
                    <div class="rank-pos" style="font-size:1.1rem; width:30px;">${index + 1}</div>
                    <div class="rank-name">${nome}</div>
                    <div class="rank-status" style="background:var(--accent-color); color:white; font-weight:bold;">${contagem[nome]} un.</div>
                </li>
            `;
    });
    html += "</ul>";
    container.innerHTML = html;
  };

  const renderPizzaRanking = (filterRange = "all") => {
    const container = document.getElementById("pizza-ranking-container");
    if (!container) return;

    const getOrdersBetween = (start, end) => {
      return database.pedidos.filter(p => {
        if (p.status !== "Concluído" && p.status !== "Pronto") return false;
        if (!p.dataEntrega) return false;
        const d = new Date(p.dataEntrega + "T00:00:00");
        return (!start || d >= start) && (!end || d <= end);
      });
    };

    const getOrdersForWeek = (weekStartString) => {
      return database.pedidos.filter(p => {
        if (p.status !== "Concluído" && p.status !== "Pronto") return false;
        if (!p.dataEntrega) return false;
        return getWeekStart(p.dataEntrega) === weekStartString;
      });
    };

    let pedidosAtuais = [];
    let pedidosAnteriores = [];
    let textoComparacao = "";

    const agora = new Date();
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

    if (filterRange === "custom-week") {
      const customWeekStr = document.getElementById("dash-week-filter")?.value;
      if (customWeekStr) {
        pedidosAtuais = getOrdersForWeek(customWeekStr);
        const dataSemanaAtual = new Date(customWeekStr + "T00:00:00");
        const dataSemanaPassada = new Date(dataSemanaAtual);
        dataSemanaPassada.setDate(dataSemanaPassada.getDate() - 7);
        const prevWeekStr = getWeekStart(dataSemanaPassada.toISOString().slice(0, 10));

        pedidosAnteriores = getOrdersForWeek(prevWeekStr);
        textoComparacao = "Semana Selecionada vs Semana Anterior";
      }
    } else if (filterRange === "week") {
      const inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - hoje.getDay() + (hoje.getDay() === 0 ? -6 : 1));

      const inicioSemanaPassada = new Date(inicioSemana);
      inicioSemanaPassada.setDate(inicioSemanaPassada.getDate() - 7);
      const fimSemanaPassada = new Date(inicioSemana);
      fimSemanaPassada.setDate(fimSemanaPassada.getDate() - 1);

      pedidosAtuais = getOrdersBetween(inicioSemana, null);
      pedidosAnteriores = getOrdersBetween(inicioSemanaPassada, fimSemanaPassada);
      textoComparacao = "Esta Semana vs Semana Passada";

    } else if (filterRange === "month") {
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
      const inicioMesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      const fimMesPassado = new Date(agora.getFullYear(), agora.getMonth(), 0);

      pedidosAtuais = getOrdersBetween(inicioMes, null);
      pedidosAnteriores = getOrdersBetween(inicioMesPassado, fimMesPassado);
      textoComparacao = "Este Mês vs Mês Passado";

    } else if (filterRange === "today") {
      const ontem = new Date(hoje);
      ontem.setDate(ontem.getDate() - 1);

      pedidosAtuais = getOrdersBetween(hoje, null);
      pedidosAnteriores = getOrdersBetween(ontem, new Date(hoje.getTime() - 1));
      textoComparacao = "Hoje vs Ontem";

    } else {
      pedidosAtuais = database.pedidos.filter(p => p.status === "Concluído" || p.status === "Pronto");
      pedidosAnteriores = [];
      textoComparacao = "Hall da Fama (Desde o Início)";
    }

    const cardTitle = container.parentElement.querySelector("h3");
    if (cardTitle) {
      cardTitle.innerHTML = `🏆 Top 10 Pizzas <small style="font-size:0.8rem; display:block; color:var(--text-light-color); font-weight:normal">(${textoComparacao})</small>`;
    }

    const calcularRank = (orders) => {
      const vendas = {};
      orders.forEach(p => {
        p.items?.forEach(i => {
          if (!i.isCustom) vendas[i.pizzaNome] = (vendas[i.pizzaNome] || 0) + i.qtd;
        });
      });
      return Object.entries(vendas)
        .sort((a, b) => b[1] - a[1])
        .map(item => item[0]);
    };

    const rankAtual = calcularRank(pedidosAtuais);
    const rankAnterior = filterRange === "all" ? [] : calcularRank(pedidosAnteriores);
    const top10Atual = rankAtual.slice(0, 10);

    container.innerHTML = "";
    if (top10Atual.length === 0) {
      container.innerHTML = "<p style='color:#777'>Sem vendas computadas para o período selecionado.</p>";
      return;
    }

    let html = "<ul class='spotify-ranking-list'>";
    top10Atual.forEach((nomePizza, index) => {
      const posicaoAtual = index + 1;
      const posicaoPassada = rankAnterior.indexOf(nomePizza) !== -1 ? rankAnterior.indexOf(nomePizza) + 1 : null;

      let icon = '<span class="rank-same">-</span>';

      if (filterRange === "all") {
        icon = '<span class="rank-fire">🔥 Hit Histórico!</span>';
      } else if (posicaoPassada === null) {
        icon = '<span class="rank-new">⭐ Nova no Top!</span>';
      } else if (posicaoAtual < posicaoPassada) {
        icon = `<span class="rank-up">▲ subiu ${posicaoPassada - posicaoAtual}</span>`;
      } else if (posicaoAtual > posicaoPassada) {
        icon = `<span class="rank-down">▼ desceu ${posicaoAtual - posicaoPassada}</span>`;
      } else {
        icon = `<span class="rank-fire">🔥 Firme no top!</span>`;
      }

      html += `
                <li>
                    <div class="rank-pos">#${posicaoAtual}</div>
                    <div class="rank-name">${nomePizza}</div>
                    <div class="rank-status">${icon}</div>
                </li>
            `;
    });
    html += "</ul>";
    container.innerHTML = html;
  };

  const renderNovosClientesChart = () => {
    const canvas = document.getElementById("novosClientesChart");
    if (!canvas) return;

    const dataPrimeiroPedido = {};

    database.pedidos.forEach(p => {
      if (!p.dataEntrega || p.status !== "Concluído") return;
      const d = new Date(p.dataEntrega + "T00:00:00");
      const clienteId = p.clienteId || p.cliente;

      if (!dataPrimeiroPedido[clienteId] || d < dataPrimeiroPedido[clienteId]) {
        dataPrimeiroPedido[clienteId] = d;
      }
    });

    const agrupadoPorMes = {};

    Object.values(dataPrimeiroPedido).forEach(data => {
      const mesChave = data.getFullYear() + "-" + String(data.getMonth() + 1).padStart(2, '0');
      const rotulo = data.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

      if (!agrupadoPorMes[mesChave]) {
        agrupadoPorMes[mesChave] = { label: rotulo, contagem: 0, sortKey: mesChave };
      }
      agrupadoPorMes[mesChave].contagem++;
    });

    const arrDados = Object.values(agrupadoPorMes).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const labels = arrDados.map(d => d.label);
    const dadosGrafico = arrDados.map(d => d.contagem);

    const ctx = canvas.getContext("2d");
    if (chartInstances.novosClientes) chartInstances.novosClientes.destroy();

    chartInstances.novosClientes = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Clientes Novos Cadastrados",
          data: dadosGrafico,
          backgroundColor: "#9b59b6",
          borderRadius: 4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  };

  document.querySelectorAll(".date-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".date-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderDashboard(btn.dataset.range);
    });
  });

  document.getElementById("dash-week-filter")?.addEventListener("change", () => {
    document.querySelectorAll(".date-filter").forEach((b) => b.classList.remove("active"));
    renderDashboard('custom-week');
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
      `${filename}_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`
    );
  };

  document.getElementById("export-ingredientes")?.addEventListener("click", () =>
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
        Pizza: pizza ? `${pizza.nome} (${pizza.tamanho || ""})` : "Pizza Removida",
        Ingredientes: r.ingredientes.map((i) => {
          const ingrediente = database.ingredientes.find((ing) => ing.id === i.ingredienteId);
          return `${i.qtd} de ${ingrediente ? ingrediente.nome : "N/A"}`;
        }).join("; "),
        "Custo Total da Receita": calculatePizzaCost(r.pizzaId),
      };
    });
    exportToExcel(data, "sasses_receitas");
  });
  const getPedidosHistoricoVisiveis = () => {
    const searchTerm = (document.getElementById("search-pedidos")?.value || "").toLowerCase().trim();
    const clienteFilter = (document.getElementById("filter-modal-cliente")?.value || "").toLowerCase().trim();
    const cidadeFilter = (document.getElementById("filter-modal-cidade")?.value || "").toLowerCase().trim();
    const vendedorFilter = document.getElementById("filter-modal-vendedor")?.value || "";
    const semanaFilter = document.getElementById("filter-modal-semana")?.value || "";
    const statusFilter = document.getElementById("filter-modal-status")?.value || "";
    const pagamentoStatusFilter = document.getElementById("filter-modal-pagamento-status")?.value || "";
    const formaPagamentoFilter = document.getElementById("filter-modal-forma-pagamento")?.value || "";
    const valorMin = getNumberValue(document.getElementById("filter-modal-valor-min")?.value, 0);
    const valorMaxRaw = document.getElementById("filter-modal-valor-max")?.value;
    const valorMax = valorMaxRaw ? getNumberValue(valorMaxRaw, Infinity) : Infinity;

    return database.pedidos.filter((p) => {
      const haystack = `${p.cliente || ""} ${p.telefone || ""} ${p.cidade || ""} ${(p.items || []).map(i => i.pizzaNome).join(" ")}`.toLowerCase();
      const searchMatch = !searchTerm || haystack.includes(searchTerm);
      const clienteMatch = !clienteFilter || (p.cliente || "").toLowerCase().includes(clienteFilter);
      const cidadeMatch = !cidadeFilter || (p.cidade || "").toLowerCase().includes(cidadeFilter);
      const vendedorName = (p.vendedor || "").trim();
      const vendedorFirstName = vendedorName.split(" ")[0];
      const normalizedVendedor = vendedorFirstName.charAt(0).toUpperCase() + vendedorFirstName.slice(1).toLowerCase();
      const vendedorMatch = !vendedorFilter || normalizedVendedor === vendedorFilter || vendedorName.toLowerCase() === vendedorFilter.toLowerCase();
      const semanaMatch = !semanaFilter || (p.dataEntrega && getWeekStart(p.dataEntrega) === semanaFilter);
      const pedidoStatus = p.status || "Pendente";
      const statusMatch = !statusFilter
        || (statusFilter === "NaoProntos" ? ["Pendente", "Confirmado"].includes(pedidoStatus) : false)
        || (statusFilter === "ConfirmadoNaoConcluido" ? ["Confirmado", "Pronto"].includes(pedidoStatus) : false)
        || pedidoStatus === statusFilter;
      const pagamentoStatusMatch = !pagamentoStatusFilter || (pagamentoStatusFilter === "pago" ? isPedidoPago(p) : (isPedidoAtivoFinanceiro(p) && !isPedidoPago(p)));
      const formaPagamentoMatch = !formaPagamentoFilter || p.pagamento === formaPagamentoFilter;
      const valorExibido = p.valorFinal || p.valorTotal;
      const valorMatch = valorExibido >= valorMin && valorExibido <= valorMax;
      return searchMatch && clienteMatch && cidadeMatch && vendedorMatch && semanaMatch && statusMatch && pagamentoStatusMatch && formaPagamentoMatch && valorMatch;
    });
  };

  window.printPedidosProducao = () => {
    const pedidos = getPedidosHistoricoVisiveis();
    if (!pedidos.length) return alert("Não há pedidos no histórico atual para imprimir.");

    const totais = new Map();
    const porMassa = { G: 0, P: 0, PC: 0, Outro: 0 };
    pedidos.forEach((p) => (p.items || []).forEach((item) => {
      const nome = item.pizzaNome || "Item sem nome";
      totais.set(nome, (totais.get(nome) || 0) + Number(item.qtd || 0));
      const pizza = database.estoque.find((e) => e.id === item.pizzaId);
      const massa = item.isCustom ? "Outro" : (mapPizzaToDough(pizza) || "Outro");
      porMassa[massa] = (porMassa[massa] || 0) + Number(item.qtd || 0);
    }));

    const pizzasHtml = Array.from(totais.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([nome, qtd]) => `<tr><td>${nome}</td><td>${qtd}</td></tr>`).join("");

    const clientesHtml = pedidos
      .sort((a, b) => String(a.cliente || "").localeCompare(String(b.cliente || "")))
      .map((p) => `<tr><td>${p.cliente || "-"}</td><td>${(p.items || []).map(i => `${i.qtd}x ${i.pizzaNome}`).join("<br>")}</td><td>${p.cidade || "-"}</td><td>${p.pagamento || "-"}${isPedidoPago(p) ? " / Pago" : " / Pendente"}</td></tr>`).join("");

    const periodo = document.getElementById("filter-modal-semana")?.selectedOptions?.[0]?.textContent || "Histórico filtrado";
    const html = `<html><head><title>Produção - Sasse's Pizza</title><style>
      body{font-family:Arial,sans-serif;padding:22px;color:#111;font-size:13px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #111;padding-bottom:6px}.meta{color:#444;margin-bottom:14px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:7px;text-align:left;vertical-align:top}th{background:#f1f1f1;text-transform:uppercase;font-size:11px}.qtd{font-size:18px;font-weight:bold}.massas{display:flex;gap:10px;flex-wrap:wrap}.box{border:1px solid #111;padding:10px;min-width:110px}.page-break{page-break-before:always}@media print{button{display:none}body{padding:0}}
    </style></head><body>
      <h1>Sasse's Pizza — Lista de Produção</h1><div class="meta">${periodo} • ${pedidos.length} pedido(s) • impresso em ${new Date().toLocaleString("pt-BR")}</div>
      <h2>Resumo de massas</h2><div class="massas"><div class="box">G<br><span class="qtd">${porMassa.G}</span></div><div class="box">P<br><span class="qtd">${porMassa.P}</span></div><div class="box">P Chocolate<br><span class="qtd">${porMassa.PC}</span></div><div class="box">Outro<br><span class="qtd">${porMassa.Outro}</span></div></div>
      <h2>Produzir por sabor</h2><table><thead><tr><th>Sabor</th><th>Quantidade</th></tr></thead><tbody>${pizzasHtml}</tbody></table>
      <h2 class="page-break">Conferência por cliente</h2><table><thead><tr><th>Cliente</th><th>Itens</th><th>Cidade</th><th>Pagamento</th></tr></thead><tbody>${clientesHtml}</tbody></table>
      <script>window.print(); setTimeout(()=>window.close(),300);<\/script>
    </body></html>`;
    const w = window.open("", "", "height=800,width=1000");
    w.document.write(html);
    w.document.close();
  };

  document.getElementById("print-pedidos")?.addEventListener("click", window.printPedidosProducao);

  document.getElementById("btn-lista-compras")?.addEventListener("click", () => {
    const itemsBaixos = database.ingredientes.filter((i) => i.qtd < i.estoqueMinimo);
    let contentHTML = "<p>Ótima notícia! Nenhum ingrediente está com estoque baixo.</p>";

    if (itemsBaixos.length > 0) {
      contentHTML = `<table><thead><tr><th>Ingrediente</th><th>Estoque Atual</th><th>Estoque Mínimo</th><th>Comprar (sugestão)</th></tr></thead><tbody>`;
      itemsBaixos.forEach((item) => {
        const comprar = (item.estoqueMinimo - item.qtd).toFixed(3);
        contentHTML += `<tr><td>${item.nome}</td><td>${item.qtd.toFixed(3)}</td><td>${item.estoqueMinimo.toFixed(3)}</td><td><b>${comprar}</b></td></tr>`;
      });
      contentHTML += "</tbody></table>";
    }
    const listaContent = document.getElementById("lista-compras-content");
    if (listaContent) listaContent.innerHTML = contentHTML;
    document.getElementById("modal-lista-compras").style.display = "block";
  });

  document.getElementById("btn-print-lista")?.addEventListener("click", () => {
    const modalContent = document.getElementById("lista-compras-content")?.innerHTML || "";
    const printWindow = window.open("", "", "height=600,width=800");
    printWindow.document.write("<html><head><title>Lista de Compras</title>");
    printWindow.document.write('<link rel="stylesheet" href="style.css">');
    printWindow.document.write("</head><body>");
    printWindow.document.write(modalContent);
    printWindow.document.write("</body></html>");
    printWindow.document.close();
    printWindow.print();
  });

  document.getElementById("form-producao")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pizzaId = document.getElementById("producao-pizza-select").value;
    const quantidade = parseInt(document.getElementById("producao-qtd").value);

    if (!pizzaId || !quantidade || quantidade <= 0) {
      alert("Por favor, selecione uma pizza e informe uma quantidade válida.");
      return;
    }

    const pizza = database.estoque.find((p) => p.id === pizzaId);
    if (!confirm(`Confirma a produção de ${quantidade}x ${pizza.nome}? 
(Esta ação apenas adicionará ao estoque, sem baixa de ingredientes).`)) {
      return;
    }

    showLoader();

    try {
      const pizzaEstoque = database.estoque.find((p) => p.id === pizzaId);
      if (!pizzaEstoque) {
        throw new Error("Pizza não encontrada no banco de dados de estoque.");
      }

      const { error } = await supabaseClient.rpc("ajustar_estoque_pizza_seguro", {
        p_pizza_id: pizzaId,
        p_delta: quantidade,
        p_observacao: "Produção registrada pelo painel",
      });

      if (error) throw error;

      showSaveStatus("Produção registrada e estoque atualizado!");
      await loadDataFromSupabase();
      e.target.reset();
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao registrar produção"), false);
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

    const dataForExcel = Object.entries(demand).map(([Sabor, Quantidade]) => ({ Sabor, Quantidade }));
    exportToExcel(dataForExcel, "demanda_de_producao");
  });

  document.getElementById("btn-notificacoes")?.addEventListener("click", window.openNotificationsModal);


  // ===== V4: Caixa, produção, impressão, venda rápida e clientes inteligentes =====
  const getWeekOrders = (weekStart, statuses = ["Pendente", "Confirmado", "Pronto", "Concluído"]) => database.pedidos.filter(p => p.dataEntrega && getWeekStart(p.dataEntrega) === weekStart && statuses.includes(p.status));

  window.marcarPedidoPago = async (id) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    showLoader();
    try {
      if (pedido?.status === "Pronto") {
        const { error } = await supabaseClient.from("pedidos").update({ pago: true, status: "Concluído" }).eq("id", id);
        if (error) throw error;
        showSaveStatus("Pedido pago e concluído.");
      } else {
        const { error } = await supabaseClient.from("pedidos").update({ pago: true }).eq("id", id);
        if (error) throw error;
        showSaveStatus("Pedido marcado como pago.");
      }
      await loadDataFromSupabase();
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Não foi possível marcar como pago"), false);
    } finally {
      hideLoader();
    }
  };

  window.printPedido = (id) => {
    const p = database.pedidos.find(x => x.id === id);
    if (!p) return;
    const itens = (p.items || []).map(i => `<li>${i.qtd}x ${i.pizzaNome}</li>`).join("");
    const html = `<html><head><title>Pedido</title><style>body{font-family:Arial;padding:20px;font-size:14px}.ticket{max-width:360px}.line{border-top:1px dashed #999;margin:12px 0}h2{margin:0 0 8px}ul{padding-left:18px}.big{font-size:18px;font-weight:bold}</style></head><body><div class="ticket"><h2>Sasse's Pizza</h2><div class="line"></div><p><b>Cliente:</b> ${p.cliente}<br><b>Tel:</b> ${p.telefone || "-"}<br><b>Cidade:</b> ${p.cidade || "-"}<br><b>Endereço:</b> ${p.endereco || "-"}<br><b>Vendedor:</b> ${p.vendedor || "-"}<br><b>Semana:</b> ${new Date(p.dataEntrega + "T00:00:00").toLocaleDateString("pt-BR")}</p><div class="line"></div><ul>${itens}</ul><div class="line"></div><p class="big">Total: ${formatCurrency(p.valorFinal || p.valorTotal)}</p><p>Pagamento: ${p.pagamento || "-"} | ${p.pago ? "PAGO" : "PENDENTE"}</p></div><script>window.print(); setTimeout(()=>window.close(),300);<\/script></body></html>`;
    const w = window.open("", "", "width=420,height=700");
    w.document.write(html); w.document.close();
  };

  const renderV4Panels = () => {
    renderQuickSale();
    renderCaixa();
    renderProducaoAuto();
    renderClientIntelligence();
    renderKitchenMode();
    renderHome();
  };

  const renderQuickSale = () => {
    const box = document.getElementById("quick-pizzas");
    if (!box) return;

    const term = (document.getElementById("quick-pizza-search")?.value || "").toLowerCase().trim();
    const pagamento = document.getElementById("quick-pagamento")?.value || "";
    const pizzas = database.estoque.filter((pizza) =>
      !term || `${pizza.nome} ${pizza.tamanho || ""}`.toLowerCase().includes(term)
    );

    box.innerHTML = pizzas.map((pizza) => {
      const qty = Number(quickSaleItems[pizza.id] || 0);
      const price = getPrecoPorPagamento(pizza.precoVenda, pagamento);
      const stockClass = Number(pizza.qtd || 0) <= 0 ? "is-empty" : "";
      const weekStart = document.getElementById("quick-semana")?.value || getWeekStart();
      return `<div class="quick-pizza ${stockClass}">
        <span>${pizza.nome} (${pizza.tamanho})<small>${formatCurrency(price)} · ${formatStockSobra(pizza.id, weekStart)}</small></span>
        <div class="qty-stepper">
          <button type="button" onclick="window.adjustQuickPizza('${pizza.id}', -1)">−</button>
          <input type="number" min="0" value="${qty}" data-pizza-id="${pizza.id}" inputmode="numeric">
          <button type="button" onclick="window.adjustQuickPizza('${pizza.id}', 1)">+</button>
        </div>
      </div>`;
    }).join("") || `<p class="empty-state compact">Nenhuma pizza encontrada.</p>`;

    box.querySelectorAll("input[data-pizza-id]").forEach((input) => {
      input.addEventListener("input", () => {
        const value = Math.max(0, parseInt(input.value) || 0);
        quickSaleItems[input.dataset.pizzaId] = value;
        input.value = quickSaleItems[input.dataset.pizzaId];
        updateQuickTotal();
      });
    });

    const quickPagamento = document.getElementById("quick-pagamento");
    if (quickPagamento) quickPagamento.onchange = () => {
      renderQuickSale();
      updateQuickTotal();
    };

    const quickDesconto = document.getElementById("quick-desconto");
    if (quickDesconto) {
      quickDesconto.oninput = updateQuickTotal;
      quickDesconto.onblur = (e) => {
        formatPercentField(e.target);
        updateQuickTotal();
      };
    }

    const quickSearch = document.getElementById("quick-pizza-search");
    if (quickSearch) quickSearch.oninput = renderQuickSale;
    const quickSemana = document.getElementById("quick-semana");
    if (quickSemana) quickSemana.onchange = renderQuickSale;
    const clearBtn = document.getElementById("quick-clear");
    if (clearBtn) clearBtn.onclick = () => {
      quickSaleItems = {};
      renderQuickSale();
      updateQuickTotal();
      document.getElementById("quick-pix-box")?.classList.add("hidden");
    };

    ["quick-save","quick-pix"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onclick = id === "quick-save" ? saveQuickSale : showQuickPix;
    });

    const d = document.getElementById("quick-cliente");
    if (d) d.oninput = () => {
      const c = database.clientes.find(x => x.nome.toLowerCase() === d.value.toLowerCase());
      if(c){
        document.getElementById("quick-telefone").value = c.telefone || "";
        document.getElementById("quick-cidade").value = c.cidade || "";
      }
    };

    updateQuickTotal();
  };

  window.adjustQuickPizza = (pizzaId, delta) => {
    const next = Math.max(0, Number(quickSaleItems[pizzaId] || 0) + delta);
    quickSaleItems[pizzaId] = next;
    const input = document.querySelector(`#quick-pizzas input[data-pizza-id="${pizzaId}"]`);
    if (input) input.value = quickSaleItems[pizzaId];
    updateQuickTotal();
  };

  const getQuickItems = () => {
    const pagamento = document.getElementById("quick-pagamento")?.value || "";
    return Object.entries(quickSaleItems).map(([pizzaId, q]) => {
      const qty = parseInt(q) || 0;
      const pizza = database.estoque.find(p => p.id === pizzaId);
      return qty > 0 && pizza ? {
        pizzaId: pizza.id,
        pizzaNome: `${pizza.nome} (${pizza.tamanho})`,
        qtd: qty,
        isCustom: false,
        preco: getPrecoPorPagamento(pizza.precoVenda, pagamento)
      } : null;
    }).filter(Boolean);
  };

  const getQuickTotals = () => {
    const base = getQuickItems().reduce((acc, item) => acc + item.preco * item.qtd, 0);
    const desconto = getQuickDiscountPercent();
    const final = applyDiscount(base, desconto);
    return { base, desconto, final };
  };

  const updateQuickTotal = () => {
    const el = document.getElementById("quick-total");
    const info = document.getElementById("quick-desconto-info");
    const totals = getQuickTotals();
    if (el) el.textContent = formatCurrency(totals.final);
    if (info) {
      const discountValue = totals.base - totals.final;
      info.textContent = totals.desconto > 0 ? `Desconto ${totals.desconto}% (${formatCurrency(discountValue)}) · ` : "";
    }
  };

  const saveQuickSale = async () => {
    const items = getQuickItems();
    if (!items.length) return alert("Escolha pelo menos uma pizza.");
    const clienteNome = document.getElementById("quick-cliente").value.trim();
    const cidade = document.getElementById("quick-cidade").value.trim();
    const vendedor = document.getElementById("quick-vendedor").value.trim();
    const dataEntrega = document.getElementById("quick-semana").value || getWeekStart();
    if (!clienteNome || !cidade || !vendedor) return alert("Preencha cliente, cidade e vendedor.");
    showLoader();
    let cliente = database.clientes.find(c=>c.nome.toLowerCase()===clienteNome.toLowerCase() && c.cidade.toLowerCase()===cidade.toLowerCase());
    let clienteId = cliente?.id;
    if(!clienteId){
      const r=await supabaseClient.from("clientes").insert({nome:clienteNome, telefone:document.getElementById("quick-telefone").value, cidade}).select().single();
      if(r.error){hideLoader(); return showSaveStatus(r.error.message,false)}
      clienteId=r.data.id;
    }
    const totals = getQuickTotals();
    const quickPedidoData = {
      cliente: clienteNome,
      clienteId,
      telefone: document.getElementById("quick-telefone").value,
      cidade,
      vendedor,
      pagamento: document.getElementById("quick-pagamento").value,
      dataEntrega,
      status: "Pendente",
      items,
      valorTotal: totals.base,
      valorFinal: totals.final,
      pago: false
    };
    const { data: pedidoSalvo, error } = await supabaseClient.rpc("criar_pedido_com_reserva", { p_pedido: quickPedidoData });
    hideLoader();
    if(error) return showSaveStatus(formatSupabaseError(error, "Erro ao registrar venda rápida"), false);
    showSaveStatus(pedidoSalvo?.estoque_baixado ? "Pedido rápido registrado e estoque reservado." : "Pedido rápido registrado como encomenda/produção pendente.");
    quickSaleItems = {};
    document.getElementById("quick-pix-box")?.classList.add("hidden");
    await loadDataFromSupabase();
  };

  
  window.openPedidoPix = (id) => {
    const pedido = database.pedidos.find((p) => p.id === id);
    if (!pedido) return;
    const amount = Number(pedido.valorFinal || pedido.valorTotal || 0);
    const payload = makePixPayload(amount);
    openModal('edit-modal', 'Pix do pedido', `
      <div class="pix-box">
        <h4>${escapeHTML(pedido.cliente || 'Cliente')}</h4>
        <p class="small-muted">Valor: <b>${formatCurrency(amount)}</b></p>
        <textarea readonly style="width:100%;min-height:120px;">${payload}</textarea>
        <img alt="QR Code Pix" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}" style="display:block;margin:1rem auto;max-width:220px;">
        <button type="button" onclick="navigator.clipboard.writeText('${payload}');">Copiar código Pix</button>
      </div>
    `);
  };
const pixCRC16 = (payload) => { let crc=0xFFFF; for(let i=0;i<payload.length;i++){crc^=payload.charCodeAt(i)<<8; for(let j=0;j<8;j++) crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1); crc&=0xFFFF;} return crc.toString(16).toUpperCase().padStart(4,"0"); };
  const emv = (id, value) => id + String(value.length).padStart(2,"0") + value;
  const makePixPayload = (amount) => { const merchant="SASSES PIZZA".slice(0,25); const city="MASSARANDUBA".slice(0,15); const mai=emv("00","BR.GOV.BCB.PIX")+emv("01","carlos.sasse@gmail.com"); let p=emv("00","01")+emv("26",mai)+emv("52","0000")+emv("53","986")+(amount>0?emv("54",amount.toFixed(2)):"")+emv("58","BR")+emv("59",merchant)+emv("60",city)+emv("62",emv("05","SASSES"))+"6304"; return p+pixCRC16(p); };
  const showQuickPix = () => {
    const amount = getQuickTotals().final;
    const payload = makePixPayload(amount);
    const box = document.getElementById("quick-pix-box");
    if(!box) return;
    box.classList.remove("hidden");
    box.innerHTML = `<h4>Pix copia e cola</h4><p class="small-muted">Valor: <b>${formatCurrency(amount)}</b></p><textarea readonly>${payload}</textarea><img alt="QR Code Pix" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}">`;
  };

  const renderCaixa = () => {
    const resumo = document.getElementById("caixa-resumo");
    if (!resumo) return;
    const pagos = database.pedidos.filter(p => p.pago);
    const receita = pagos.reduce((a, p) => a + Number(p.valorFinal || p.valorTotal || 0), 0);
    const entradas = (database.caixa_movimentos || []).filter(m => m.tipo === "entrada").reduce((a, m) => a + Number(m.valor || 0), 0);
    const despesas = (database.caixa_movimentos || []).filter(m => m.tipo === "despesa").reduce((a, m) => a + Number(m.valor || 0), 0);
    resumo.innerHTML = `<div class="kpi-card"><span>Receita paga</span><b>${formatCurrency(receita)}</b></div><div class="kpi-card"><span>Entradas extras</span><b>${formatCurrency(entradas)}</b></div><div class="kpi-card"><span>Despesas</span><b>${formatCurrency(despesas)}</b></div><div class="kpi-card"><span>Saldo</span><b>${formatCurrency(receita + entradas - despesas)}</b></div>`;

    const tbody = document.querySelector("#tabela-caixa tbody");
    if (tbody) {
      tbody.innerHTML = (database.caixa_movimentos || []).map(m => `
        <tr>
          <td data-label="Data">${new Date(m.data + "T00:00:00").toLocaleDateString("pt-BR")}</td>
          <td data-label="Tipo">${m.tipo === "entrada" ? "Entrada" : "Despesa"}</td>
          <td data-label="Descrição">${escapeHTML(m.descricao || "")}</td>
          <td data-label="Valor">${formatCurrency(m.valor)}</td>
          <td data-label="Ações">
            <button class="action-btn edit-btn" onclick="window.editCaixa('${m.id}')">Editar</button>
            <button class="action-btn remove-btn" onclick="window.removeCaixa('${m.id}')">Remover</button>
          </td>
        </tr>`).join("");
    }
  };

  document.getElementById("form-caixa")?.addEventListener("submit", async e => {
    e.preventDefault();
    showLoader();
    const data = {
      tipo: document.getElementById("caixa-tipo").value,
      descricao: document.getElementById("caixa-descricao").value,
      valor: parseFloat(document.getElementById("caixa-valor").value) || 0,
      data: document.getElementById("caixa-data").value || formatDateToYYYYMMDD(new Date())
    };
    const r = await supabaseClient.from("caixa_movimentos").insert(data);
    hideLoader();
    if (r.error) return showSaveStatus("Erro no caixa: " + r.error.message, false);
    e.target.reset();
    showSaveStatus("Movimento salvo.");
    await loadDataFromSupabase();
  });

  window.editCaixa = (id) => {
    const movimento = (database.caixa_movimentos || []).find((m) => m.id === id);
    if (!movimento) return;
    const formHTML = `
      <form id="edit-caixa-form" class="edit-form">
        <div class="edit-section">
          <div class="edit-section-title"><span>Movimento de caixa</span><small>Edite todos os campos</small></div>
          <div class="edit-grid two">
            <label>Tipo
              <select name="tipo" required>
                <option value="despesa" ${movimento.tipo === "despesa" ? "selected" : ""}>Despesa</option>
                <option value="entrada" ${movimento.tipo === "entrada" ? "selected" : ""}>Entrada extra</option>
              </select>
            </label>
            <label>Data
              <input type="date" name="data" value="${escapeAttr(movimento.data || formatDateToYYYYMMDD(new Date()))}" required>
            </label>
            <label>Descrição
              <input type="text" name="descricao" value="${escapeAttr(movimento.descricao || "")}" required>
            </label>
            <label>Valor
              <input type="number" name="valor" value="${safeNumber(movimento.valor).toFixed(2)}" min="0" step="0.01" required>
            </label>
          </div>
        </div>
        <div class="edit-actions">
          <button type="button" class="secondary-btn" onclick="closeModal('edit-modal')">Cancelar</button>
          <button type="submit">Salvar movimento</button>
        </div>
      </form>`;
    openModal("edit-modal", "Editar movimento de caixa", formHTML, () => {
      document.getElementById("edit-caixa-form").onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        showLoader();
        const { error } = await supabaseClient.from("caixa_movimentos").update({
          tipo: formData.get("tipo"),
          data: formData.get("data"),
          descricao: String(formData.get("descricao") || "").trim(),
          valor: safeNumber(formData.get("valor")),
        }).eq("id", id);
        hideLoader();
        if (error) return showSaveStatus("Erro ao atualizar caixa: " + error.message, false);
        showSaveStatus("Movimento atualizado.");
        closeModal("edit-modal");
        await loadDataFromSupabase();
      };
    });
  };

  window.removeCaixa = async (id) => {
    if (!confirm("Remover movimento?")) return;
    await supabaseClient.from("caixa_movimentos").delete().eq("id", id);
    await loadDataFromSupabase();
  };

  document.getElementById("export-caixa")?.addEventListener("click", () => {
    const data = (database.caixa_movimentos || []).map(m => ({ Data: m.data, Tipo: m.tipo, Descricao: m.descricao, Valor: m.valor }));
    exportToExcel(data, "sasses_caixa");
  });

  const getWeeklyPizzaSales = (weekStart) => {
    const totals = {};
    database.pedidos
      .filter((pedido) => {
        if (!pedido.dataEntrega) return false;
        return getWeekStart(pedido.dataEntrega) === weekStart && ["Pendente", "Confirmado", "Pronto", "Concluído"].includes(pedido.status);
      })
      .forEach((pedido) => {
        (pedido.items || []).forEach((item) => {
          if (item.isCustom || !item.pizzaId) return;
          totals[item.pizzaId] = (totals[item.pizzaId] || 0) + Number(item.qtd || 0);
        });
      });
    return totals;
  };

  const getPreviousWeekStarts = (weekStart, count = 4) => {
    const base = new Date(weekStart + "T00:00:00");
    return Array.from({ length: count }, (_, index) => {
      const d = new Date(base);
      d.setDate(d.getDate() - ((index + 1) * 7));
      return getWeekStart(d.toISOString().slice(0, 10));
    });
  };

  const getProductionSuggestion = (weekStart) => {
    const demand = computePizzaDemandForWeek(weekStart);
    const previousWeeks = getPreviousWeekStarts(weekStart, 4).map((ws) => getWeeklyPizzaSales(ws));

    return database.estoque.map((pizza) => {
      const pedidos = Number(demand[pizza.id] || 0);
      const historico = previousWeeks.map((weekMap) => Number(weekMap[pizza.id] || 0));
      const mediaAnterior = historico.length ? historico.reduce((a, b) => a + b, 0) / historico.length : 0;
      const maiorSemana = Math.max(0, ...historico);
      const estoque = Number(pizza.qtd || 0);
      const produzirPedidos = Math.max(0, pedidos - estoque);
      const alvoSugerido = Math.ceil(Math.max(pedidos, mediaAnterior));
      const produzirSugerido = Math.max(0, alvoSugerido - estoque);
      return { pizza, pedidos, estoque, sobra: estoque - pedidos, mediaAnterior, maiorSemana, produzirPedidos, produzirSugerido };
    })
      .filter((x) => x.pedidos > 0 || x.produzirPedidos > 0 || x.produzirSugerido > 0 || x.mediaAnterior >= 1)
      .sort((a, b) => b.produzirPedidos - a.produzirPedidos || b.produzirSugerido - a.produzirSugerido || b.pedidos - a.pedidos);
  };

  const renderProducaoAuto = () => {
    const sel = document.getElementById("producao-semana");
    if (!sel) return;
    if (!sel.dataset.ready) {
      populateWeekSelector(sel, { futureOnly: true, futureWeeks: 4, setCurrentDefault: true, keepPlaceholder: false });
      sel.dataset.ready = "true";
    }
    const week = sel.value || getWeekStart();
    sel.onchange = renderProducaoAuto;

    const data = getProductionSuggestion(week);
    const precisaProduzir = data.filter((x) => x.produzirPedidos > 0);
    const sugerida = data.filter((x) => x.produzirSugerido > 0);
    const tbody = document.querySelector("#tabela-producao-auto tbody");
    if (tbody) {
      tbody.innerHTML = precisaProduzir.map((x) => `<tr class="low-stock">
        <td data-label="Pizza"><b>${x.pizza.nome} (${x.pizza.tamanho})</b><br><small>Média 4 sem.: ${x.mediaAnterior.toFixed(1)} · pico: ${x.maiorSemana}</small></td>
        <td data-label="Pedidos">${x.pedidos}</td>
        <td data-label="Estoque">${x.estoque}</td>
        <td data-label="Sobra">${x.sobra}</td>
        <td data-label="Produzir agora"><b>${x.produzirPedidos}</b></td>
      </tr>`).join("") || `<tr><td colspan="5">Nenhuma pizza precisa ser produzida para os pedidos pendentes dessa semana.</td></tr>`;
    }

    const tbodySug = document.querySelector("#tabela-producao-sugerida tbody");
    if (tbodySug) {
      tbodySug.innerHTML = sugerida.map((x) => `<tr>
        <td data-label="Pizza"><b>${x.pizza.nome} (${x.pizza.tamanho})</b></td>
        <td data-label="Pedidos semana">${x.pedidos}</td>
        <td data-label="Média anterior">${x.mediaAnterior.toFixed(1)}</td>
        <td data-label="Estoque">${x.estoque}</td>
        <td data-label="Sugestão"><b>${x.produzirSugerido}</b></td>
      </tr>`).join("") || `<tr><td colspan="5">Sem sugestão extra com base nas semanas anteriores.</td></tr>`;
    }

    const insumos = {};
    const baseInsumos = precisaProduzir.length ? precisaProduzir : sugerida;
    baseInsumos.forEach((x) => {
      const qtd = Math.max(x.produzirPedidos, x.produzirSugerido);
      const rec = database.receitas.find((r) => r.pizzaId === x.pizza.id);
      (rec?.ingredientes || []).forEach((it) => {
        insumos[it.ingredienteId] = (insumos[it.ingredienteId] || 0) + (Number(it.qtd) || 0) * qtd;
      });
    });
    const tbody2 = document.querySelector("#tabela-insumos-auto tbody");
    if (tbody2) {
      tbody2.innerHTML = Object.entries(insumos).map(([id, need]) => {
        const ing = database.ingredientes.find((i) => i.id === id) || {};
        const comprar = Math.max(0, need - (ing.qtd || 0));
        return `<tr class="${comprar > 0 ? "low-stock" : ""}"><td data-label="Ingrediente">${ing.nome || "Ingrediente"}</td><td data-label="Necessário">${need.toFixed(3)}</td><td data-label="Estoque">${Number(ing.qtd || 0).toFixed(3)}</td><td data-label="Comprar"><b>${comprar.toFixed(3)}</b></td></tr>`;
      }).join("") || `<tr><td colspan="4">Sem necessidade extra.</td></tr>`;
    }

    const alertas = document.getElementById("producao-alertas");
    if (alertas) {
      const cards = [
        `<span>Pedidos pendentes: ${data.reduce((a, x) => a + x.pedidos, 0)}</span>`,
        `<span>Produzir por pedido: ${precisaProduzir.reduce((a, x) => a + x.produzirPedidos, 0)}</span>`,
        `<span>Sugestão pela média: ${sugerida.reduce((a, x) => a + x.produzirSugerido, 0)}</span>`,
      ];
      alertas.innerHTML = cards.join("");
    }
  };
  document.getElementById("print-producao")?.addEventListener("click", () => { const content=document.getElementById("producao")?.innerHTML||""; const w=window.open("","","width=900,height=700"); w.document.write(`<html><head><title>Produção</title><link rel="stylesheet" href="style.css"></head><body>${content}<script>window.print()<\/script></body></html>`); w.document.close(); });

  const getPedidosDoCliente = (cliente) => database.pedidos.filter((pedido) => {
    const sameId = cliente.id && pedido.clienteId === cliente.id;
    const sameName = (pedido.cliente || "").toLowerCase() === (cliente.nome || "").toLowerCase();
    const sameCity = !cliente.cidade || !pedido.cidade || (pedido.cidade || "").toLowerCase() === (cliente.cidade || "").toLowerCase();
    return sameId || (sameName && sameCity);
  });

  const getClientInsight = (cliente) => {
    const pedidos = getPedidosDoCliente(cliente);
    const total = pedidos.reduce((acc, pedido) => acc + Number(pedido.valorFinal || pedido.valorTotal || 0), 0);
    const pendentes = pedidos.filter((pedido) => isPedidoAtivoFinanceiro(pedido) && !isPedidoPago(pedido));
    const valorPendente = pendentes.reduce((acc, pedido) => acc + Number(pedido.valorFinal || pedido.valorTotal || 0), 0);
    const ticketMedio = pedidos.length ? total / pedidos.length : 0;
    const lastDate = pedidos
      .map((pedido) => pedido.dataEntrega || pedido.created_at)
      .filter(Boolean)
      .sort()
      .pop();
    const daysSinceLast = lastDate ? Math.floor((new Date() - new Date(lastDate + (lastDate.includes("T") ? "" : "T00:00:00"))) / 86400000) : null;

    const reasons = [];
    const tags = [];
    let score = 0;

    if (valorPendente > 0) {
      reasons.push(`tem ${pendentes.length} pagamento(s) pendente(s), somando ${formatCurrency(valorPendente)}`);
      tags.push("⚠️ Deve");
      score += 100000 + valorPendente;
    }
    if (pedidos.length >= 6) {
      reasons.push(`compra bastante: ${pedidos.length} pedidos registrados`);
      tags.push("🔥 Recorrente");
      score += pedidos.length * 400;
    }
    if (total >= 600) {
      reasons.push(`gera alto faturamento: ${formatCurrency(total)} no histórico`);
      tags.push("💰 Alto valor");
      score += total;
    }
    if (ticketMedio >= 90) {
      reasons.push(`tem ticket médio alto: ${formatCurrency(ticketMedio)}`);
      tags.push("⭐ Ticket alto");
      score += ticketMedio * 10;
    }
    if (daysSinceLast !== null && daysSinceLast >= 45 && pedidos.length >= 2 && valorPendente === 0) {
      reasons.push(`sumiu há ${daysSinceLast} dias`);
      tags.push("📞 Reativar");
      score += 800;
    }
    if (pedidos.length > 0 && reasons.length === 0) {
      reasons.push("cliente com histórico recente, mas sem alerta especial");
      tags.push("✅ Normal");
      score += pedidos.length * 100 + total;
    }

    return { cliente, pedidos, total, pendentes, valorPendente, ticketMedio, daysSinceLast, reasons, tags, score };
  };

  const renderClientIntelligence = () => {
    const clientesTab = document.getElementById("clientes");
    if (!clientesTab) return;
    let card = document.getElementById("client-intelligence");
    if (!card) {
      card = document.createElement("div");
      card.id = "client-intelligence";
      card.className = "card";
      clientesTab.prepend(card);
    }

    const rows = database.clientes
      .map(getClientInsight)
      .filter((row) => row.pedidos.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    card.innerHTML = `
      <div class="section-title-row">
        <div>
          <h3>Clientes inteligentes</h3>
          <p class="small-muted">Mostra quem merece atenção e o motivo: compra muito, deve, tem ticket alto ou sumiu.</p>
        </div>
      </div>
      <div class="smart-clients">
        ${rows.map((row) => {
          const primaryClass = row.valorPendente > 0 ? "danger" : row.total >= 600 ? "success" : "";
          return `<div class="smart-client ${primaryClass}">
            <div class="smart-client-head">
              <b>${row.valorPendente > 0 ? '<span class="debt-dot">!</span> ' : ''}${row.cliente.nome}</b>
              <span>${row.tags.slice(0, 2).join(" ")}</span>
            </div>
            <div class="smart-client-stats">
              <span>${row.pedidos.length} pedidos</span>
              <span>${formatCurrency(row.total)}</span>
              <span>Ticket ${formatCurrency(row.ticketMedio)}</span>
            </div>
            <small><b>Por que aparece:</b> ${row.reasons.join("; ")}.</small>
          </div>`;
        }).join("") || '<p class="empty-state compact">Ainda não há histórico suficiente.</p>'}
      </div>
    `;
  };



  
  const getWeekPedidos = (weekStart, onlyPending = false) => database.pedidos.filter((pedido) => {
    const sameWeek = getWeekStart(pedido.dataEntrega || pedido.created_at || getWeekStart()) === weekStart;
    if (!sameWeek || !isPedidoAtivoFinanceiro(pedido)) return false;
    return onlyPending ? pedido.status !== "Concluído" : true;
  });

  const getFutureWeekOptions = (count = 4) => {
    const current = new Date(getWeekStart() + "T00:00:00");
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(current);
      d.setDate(d.getDate() + (i * 7));
      const ws = getWeekStart(d.toISOString().slice(0, 10));
      const end = new Date(d); end.setDate(end.getDate() + 6);
      return { value: ws, label: `Semana de ${d.toLocaleDateString("pt-BR", {day:"2-digit", month:"short"})} a ${end.toLocaleDateString("pt-BR", {day:"2-digit", month:"short"})}` };
    });
  };

  const renderHome = () => {
    const week = getWeekStart();
    const homeKpis = document.getElementById("home-kpis");
    const pendingBox = document.getElementById("home-pedidos-pendentes");
    const prodBox = document.getElementById("home-producao");
    const sobraBox = document.getElementById("home-sobras");
    const alertBox = document.getElementById("home-alertas");
    if (!homeKpis || !pendingBox || !prodBox || !sobraBox || !alertBox) return;

    const pedidosSemana = getWeekPedidos(week, false);
    const pendentes = pedidosSemana.filter((p) => isPedidoAtivoFinanceiro(p) && p.status !== "Concluído");
    const pagosSemana = pedidosSemana.filter((p) => isPedidoPago(p));
    const faturamentoSemana = pagosSemana.reduce((a, p) => a + Number(p.valorFinal || p.valorTotal || 0), 0);
    const quantidadeSemana = pedidosSemana.reduce((a, p) => a + (p.items || []).reduce((n, it) => n + Number(it.qtd || 0), 0), 0);
    const sugerida = getProductionSuggestion(week);
    const precisaProduzir = sugerida.filter((x) => x.produzirPedidos > 0);
    const sobras = database.estoque
      .map((pizza) => ({ pizza, sobra: Number(pizza.qtd || 0) - Number((computePizzaDemandForWeek(week)[pizza.id] || 0)) }))
      .filter((x) => x.sobra > 0)
      .sort((a,b) => b.sobra - a.sobra)
      .slice(0, 8);
    const pendencias = getSystemAlerts();
    homeKpis.innerHTML = `
      <div class="kpi-tile"><span>Pedidos pendentes</span><b>${pendentes.length}</b><small>Semana atual</small></div>
      <div class="kpi-tile"><span>Pizzas na semana</span><b>${quantidadeSemana}</b><small>Entre pedidos registrados</small></div>
      <div class="kpi-tile"><span>Receita já paga</span><b>${formatCurrency(faturamentoSemana)}</b><small>Pagamentos confirmados</small></div>
      <div class="kpi-tile"><span>Pendências</span><b>${pendencias.total}</b><small>Prontos para concluir</small></div>`;

    pendingBox.innerHTML = `<div class="home-list">${pendentes.slice(0,6).map((p) => `<div class="home-list-item"><b>${escapeHTML(p.cliente || 'Cliente')}</b><span class="badge-inline ${isPedidoPago(p)?'success':'warning'}">${escapeHTML(p.status || 'Pendente')}</span><small>${(p.items || []).map((it) => `${it.qtd}x ${it.pizzaNome}`).join(' · ') || 'Sem itens'}<br>${formatCurrency(p.valorFinal || p.valorTotal || 0)}</small></div>`).join('') || '<p class="empty-state compact">Sem pedidos pendentes na semana.</p>'}</div>`;

    prodBox.innerHTML = `<div class="home-list">${precisaProduzir.slice(0,6).map((x) => `<div class="home-list-item"><b>${escapeHTML(x.pizza.nome)} (${escapeHTML(x.pizza.tamanho)})</b><span class="badge-inline danger">Produzir ${x.produzirPedidos}</span><small>Pedidos: ${x.pedidos} · Estoque: ${x.estoque} · Média 4 semanas: ${x.mediaAnterior.toFixed(1)}</small></div>`).join('') || '<p class="empty-state compact">Nada urgente para produzir.</p>'}</div>`;

    sobraBox.innerHTML = `<div class="home-list">${sobras.map((x) => `<div class="home-list-item"><b>${escapeHTML(x.pizza.nome)} (${escapeHTML(x.pizza.tamanho)})</b><span class="badge-inline success">${x.sobra} disponível</span><small>Estoque: ${x.pizza.qtd} · Demanda da semana: ${computePizzaDemandForWeek(week)[x.pizza.id] || 0}</small></div>`).join('') || '<p class="empty-state compact">Sem sobras positivas nesta semana.</p>'}</div>`;

    alertBox.innerHTML = `<div class="home-list">
      <div class="home-list-item"><b>Prontos para concluir</b><span class="badge-inline ${pendencias.total ? 'danger' : 'success'}">${pendencias.total}</span><small>${pendencias.prontosParaConcluir.slice(0,4).map((p) => `${p.cliente} · ${formatCurrency(p.valorFinal || p.valorTotal || 0)}`).join('<br>') || 'Nenhuma pendência.'}</small></div>
      <div class="home-list-item"><b>Ações rápidas</b><small><button class="home-action" data-open-tab="pedidos">Novo pedido</button> <button class="home-action" data-open-tab="cozinha">Abrir cozinha</button></small></div>
    </div>`;
    document.querySelectorAll("#inicio [data-open-tab]").forEach((btn) => btn.onclick = () => openTab(btn.dataset.openTab));
  };

  const renderKitchenMode = () => {
    const select = document.getElementById("cozinha-semana");
    const list = document.getElementById("cozinha-lista");
    if (!select || !list) return;
    if (!select.dataset.ready) {
      populateWeekSelector(select, { futureOnly: true, futureWeeks: 4, setCurrentDefault: true, keepPlaceholder: false });
      select.dataset.ready = '1';
    }
    const week = select.value || getWeekStart();
    select.onchange = renderKitchenMode;
    const data = getProductionSuggestion(week).filter((x) => x.produzirPedidos > 0 || x.produzirSugerido > 0);
    list.innerHTML = data.map((x) => `<div class="kitchen-item ${x.produzirPedidos > 0 ? 'low-stock' : ''}">
      <div class="kitchen-item-main">
        <b>${escapeHTML(x.pizza.nome)} (${escapeHTML(x.pizza.tamanho)})</b>
        <small>Pedidos: ${x.pedidos} · Estoque: ${x.estoque} · Sobra: ${x.sobra} · Sugestão: ${x.produzirSugerido}</small>
      </div>
      <div class="kitchen-qty">${Math.max(x.produzirPedidos, x.produzirSugerido)}</div>
    </div>`).join('') || `<p class="empty-state">Nenhuma pizza para produzir nessa semana.</p>`;
  };

  document.getElementById("print-cozinha")?.addEventListener("click", () => {
    const content = document.getElementById("cozinha")?.innerHTML || "";
    const w = window.open("", "", "width=900,height=700");
    w.document.write(`<html><head><title>Modo Cozinha</title><link rel="stylesheet" href="style.css"></head><body>${content}<script>window.print()<\/script></body></html>`);
    w.document.close();
  });

  const renderDashboardCompareCards = (filteredPedidos) => {
    const box = document.getElementById("dashboard-compare-cards");
    if (!box) return;
    const currentWs = getWeekStart();
    const prevDate = new Date(currentWs + "T00:00:00");
    prevDate.setDate(prevDate.getDate() - 7);
    const prevWs = getWeekStart(prevDate.toISOString().slice(0,10));
    const getWeekStats = (ws) => {
      const pedidos = getWeekPedidos(ws, false);
      const receita = pedidos.filter((p) => isPedidoPago(p)).reduce((a,p) => a + Number(p.valorFinal || p.valorTotal || 0), 0);
      const pizzas = pedidos.reduce((a,p) => a + (p.items || []).reduce((n,it) => n + Number(it.qtd || 0), 0), 0);
      const clientes = new Set(pedidos.map((p) => (p.cliente || '').toLowerCase()).filter(Boolean)).size;
      const pendencias = pedidos.filter((p) => isPedidoAtivoFinanceiro(p) && !isPedidoPago(p)).reduce((a,p) => a + Number(p.valorFinal || p.valorTotal || 0), 0);
      return { pedidos: pedidos.length, receita, pizzas, clientes, pendencias };
    };
    const cur = getWeekStats(currentWs), prev = getWeekStats(prevWs);
    const diff = (a,b,prefix='') => {
      const delta = a-b; const sign = delta > 0 ? '▲' : delta < 0 ? '▼' : '•';
      return `${sign} ${prefix}${Math.abs(delta).toFixed(prefix ? 2 : 0).replace('.', ',')}`;
    };
    box.innerHTML = `
      <div class="kpi-tile"><span>Pedidos na semana</span><b>${cur.pedidos}</b><small>Semana passada: ${prev.pedidos} · ${diff(cur.pedidos, prev.pedidos)}</small></div>
      <div class="kpi-tile"><span>Receita paga</span><b>${formatCurrency(cur.receita)}</b><small>Semana passada: ${formatCurrency(prev.receita)} · ${diff(cur.receita, prev.receita, 'R$ ')}</small></div>
      <div class="kpi-tile"><span>Pizzas vendidas</span><b>${cur.pizzas}</b><small>Semana passada: ${prev.pizzas} · ${diff(cur.pizzas, prev.pizzas)}</small></div>
      <div class="kpi-tile"><span>Em aberto</span><b>${formatCurrency(cur.pendencias)}</b><small>Semana passada: ${formatCurrency(prev.pendencias)} · ${diff(cur.pendencias, prev.pendencias, 'R$ ')}</small></div>`;
  };

  const runGlobalSearch = () => {
    const term = (document.getElementById("global-search")?.value || '').toLowerCase().trim();
    const box = document.getElementById("global-search-results");
    if (!box) return;
    if (!term) {
      box.innerHTML = '<p class="empty-state">Digite algo para buscar.</p>';
      openModal('global-search-modal', 'Busca global', box.innerHTML);
      return;
    }
    const clientes = database.clientes.filter((c) => [c.nome, c.cidade, c.telefone].some((v) => String(v || '').toLowerCase().includes(term))).slice(0,8);
    const pedidos = database.pedidos.filter((p) => [p.cliente, p.telefone, p.cidade, p.vendedor, p.codigo_publico, p.id, ...(p.items || []).map((it) => it.pizzaNome)].some((v) => String(v || '').toLowerCase().includes(term))).slice(0,8);
    const pizzas = database.estoque.filter((p) => [p.nome, p.tamanho].some((v) => String(v || '').toLowerCase().includes(term))).slice(0,8);
    box.innerHTML = `<div class="search-results-groups">
      <div class="search-group"><h3>Clientes</h3>${clientes.map((c) => `<div class="search-result-item"><div><b>${escapeHTML(c.nome)}</b><small>${escapeHTML(c.cidade || 'Sem cidade')} · ${escapeHTML(c.telefone || 'Sem telefone')}</small></div><button class="home-action" data-open-tab="clientes">Abrir</button></div>`).join('') || '<p class="empty-state compact">Nenhum cliente.</p>'}</div>
      <div class="search-group"><h3>Pedidos</h3>${pedidos.map((p) => `<div class="search-result-item"><div><b>${escapeHTML(p.cliente || 'Cliente')}</b><small>${escapeHTML((p.items || []).map((it) => `${it.qtd}x ${it.pizzaNome}`).join(' · '))}<br>${formatCurrency(p.valorFinal || p.valorTotal || 0)} · ${escapeHTML(p.status || '')}</small></div><button class="home-action" data-open-pedido="${p.id}">Abrir pedido</button></div>`).join('') || '<p class="empty-state compact">Nenhum pedido.</p>'}</div>
      <div class="search-group"><h3>Pizzas</h3>${pizzas.map((p) => `<div class="search-result-item"><div><b>${escapeHTML(p.nome)} (${escapeHTML(p.tamanho)})</b><small>Estoque ${p.qtd} · Preço ${formatCurrency(p.precoVenda)}</small></div><button class="home-action" data-open-tab="estoque">Abrir</button></div>`).join('') || '<p class="empty-state compact">Nenhuma pizza.</p>'}</div>
    </div>`;
    openModal('global-search-modal', 'Busca global', box.innerHTML, () => {
      document.querySelectorAll('#global-search-modal [data-open-tab]').forEach((btn) => btn.onclick = () => { closeModal('global-search-modal'); openTab(btn.dataset.openTab); });
      document.querySelectorAll('#global-search-modal [data-open-pedido]').forEach((btn) => btn.onclick = () => { closeModal('global-search-modal'); openTab('pedidos'); window.openEditPedidoModal(btn.dataset.openPedido); });
    });
  };
  document.getElementById("global-search-btn")?.addEventListener("click", runGlobalSearch);
  document.getElementById("global-search")?.addEventListener("keydown", (e) => { if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); } });

  const keepMobileViewportLocked = () => {
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  };
  window.addEventListener("resize", keepMobileViewportLocked);
  window.addEventListener("orientationchange", () => setTimeout(keepMobileViewportLocked, 80));


  // ===== V15: Mobile app shell (separado do layout desktop) =====
  let mobilePage = "inicio";
  let mobileOrderItems = [];
  let mobileSaleItems = {};

  const isMobileViewport = () => window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  const syncMobileRuntimeClass = () => document.body.classList.toggle("mobile-runtime", isMobileViewport());
  syncMobileRuntimeClass();
  window.addEventListener("resize", syncMobileRuntimeClass);

  const mobileWeekOptionsHTML = (futureWeeks = 4) => {
    const current = new Date(getWeekStart() + "T00:00:00");
    let html = "";
    for (let i = 0; i <= futureWeeks; i++) {
      const start = new Date(current);
      start.setDate(start.getDate() + i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const value = getWeekStart(start.toISOString().slice(0, 10));
      const label = `Semana de ${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} a ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
      html += `<option value="${value}">${label}</option>`;
    }
    return html;
  };

  const getMobileSellerName = () => getCurrentSeller()?.nome || document.getElementById("pedido-vendedor")?.value || "";

  const renderMobileShell = (html) => {
    const screen = document.getElementById("mobile-screen");
    if (screen) screen.innerHTML = html;
    document.querySelectorAll(".mobile-app-nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.mobilePage === mobilePage));
    document.querySelectorAll("[data-mobile-page-go]").forEach((btn) => btn.addEventListener("click", () => {
      mobilePage = btn.dataset.mobilePageGo;
      const search = document.getElementById("mobile-search");
      if (search) search.value = "";
      renderMobileApp();
    }));
  };

  const mPizzaOptions = () => database.estoque.map((p) => `<option value="${p.id}">${escapeHTML(p.nome)} (${escapeHTML(p.tamanho || "")}) · Est. ${p.qtd}</option>`).join("");

  const renderMobilePixPreview = (containerId, amount, title = "Pix") => {
    const box = document.getElementById(containerId);
    if (!box) return;
    const value = Number(amount || 0);
    if (!value || value <= 0) {
      box.dataset.visible = "1";
      box.innerHTML = `<div class="m-card"><p class="m-muted">Adicione pizzas para gerar o Pix.</p></div>`;
      return;
    }
    const payload = makePixPayload(value);
    box.dataset.visible = "1";
    box.innerHTML = `
      <div class="m-pix-card">
        <div class="m-item-head">
          <b>${escapeHTML(title)}</b>
          <span class="m-badge ok">${formatCurrency(value)}</span>
        </div>
        <img alt="QR Code Pix" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}">
        <textarea readonly>${escapeHTML(payload)}</textarea>
        <button type="button" class="m-btn secondary" data-copy-mobile-pix>Copiar Pix copia e cola</button>
      </div>`;
    box.querySelector("[data-copy-mobile-pix]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(payload);
        showSaveStatus("Pix copiado!");
      } catch (e) {
        alert("Copie o código manualmente.");
      }
    });
  };

  const openMobilePixModal = (amount, cliente = "Cliente") => {
    const value = Number(amount || 0);
    if (!value || value <= 0) return;
    const payload = makePixPayload(value);
    openModal("edit-modal", "Pix do pedido", `
      <div class="pix-box m-pix-card">
        <h4>${escapeHTML(cliente)}</h4>
        <p class="small-muted">Valor: <b>${formatCurrency(value)}</b></p>
        <img alt="QR Code Pix" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}">
        <textarea readonly style="width:100%;min-height:120px;">${escapeHTML(payload)}</textarea>
        <button type="button" id="copy-mobile-pix-modal">Copiar código Pix</button>
      </div>
    `, () => {
      document.getElementById("copy-mobile-pix-modal")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(payload);
        showSaveStatus("Pix copiado!");
      });
    });
  };

  const calcMobileOrderTotal = () => mobileOrderItems.reduce((acc, it) => acc + Number(it.preco || 0) * Number(it.qtd || 0), 0);

  const updateMobileOrderTotal = () => {
    const total = calcMobileOrderTotal();
    const discount = parsePercent(document.getElementById("m-pedido-desconto")?.value);
    const final = applyDiscount(total, discount);
    const totalEl = document.getElementById("m-pedido-total");
    const finalInput = document.getElementById("m-pedido-valor-final");
    if (totalEl) totalEl.textContent = formatCurrency(final);
    if (finalInput && !finalInput.dataset.userEdited) finalInput.value = final.toFixed(2);
    const pixBox = document.getElementById("m-pedido-pix-box");
    if (pixBox?.dataset.visible === "1") {
      const amount = safeNumber(finalInput?.value, final);
      renderMobilePixPreview("m-pedido-pix-box", amount, "Pix do pedido");
    }
  };

  const renderMobileOrderCart = () => {
    const box = document.getElementById("m-pedido-carrinho");
    if (!box) return;
    box.innerHTML = mobileOrderItems.map((it, idx) => `<div class="m-cart-row"><div><b>${escapeHTML(it.qtd)}x ${escapeHTML(it.pizzaNome)}</b><div class="m-line">${formatCurrency(it.preco)} cada</div></div><button type="button" class="m-mini-btn" data-remove-mobile-order="${idx}">×</button></div>`).join("") || `<div class="m-muted">Nenhuma pizza adicionada.</div>`;
    box.querySelectorAll("[data-remove-mobile-order]").forEach((btn) => btn.onclick = () => {
      mobileOrderItems.splice(Number(btn.dataset.removeMobileOrder), 1);
      renderMobileOrderCart();
      updateMobileOrderTotal();
    });
  };

  const summarizeMobileItems = (items, max = 3) => {
    const list = (items || []).map((it) => `${it.qtd}x ${it.pizzaNome}`);
    if (list.length <= max) return escapeHTML(list.join(" · "));
    return escapeHTML(list.slice(0, max).join(" · ") + ` · +${list.length - max} item(ns)`);
  };

  const renderMobileInicio = () => {
    const week = getWeekStart();
    const pedidosSemana = database.pedidos.filter((p) => p.dataEntrega && getWeekStart(p.dataEntrega) === week);
    const pendentes = pedidosSemana.filter((p) => isPedidoAtivoFinanceiro(p) && p.status !== "Concluído");
    const receitaPaga = pedidosSemana.filter(isPedidoPago).reduce((a, p) => a + Number(p.valorFinal || p.valorTotal || 0), 0);
    const pizzasSemana = pedidosSemana.reduce((a, p) => a + (p.items || []).reduce((n, it) => n + Number(it.qtd || 0), 0), 0);
    const prod = getProductionSuggestion(week).filter((x) => x.produzirPedidos > 0).slice(0, 5);
    const alerts = getSystemAlerts();
    renderMobileShell(`<section class="m-section">
      <div class="m-card"><h2>Visão geral</h2><p class="m-muted">Resumo da semana atual. Use a barra de baixo para vender, produzir e consultar.</p></div>
      <div class="m-kpis">
        <div class="m-kpi"><span>Pedidos pendentes</span><b>${pendentes.length}</b></div>
        <div class="m-kpi"><span>Pizzas da semana</span><b>${pizzasSemana}</b></div>
        <div class="m-kpi"><span>Receita paga</span><b>${formatCurrency(receitaPaga)}</b></div>
        <div class="m-kpi"><span>Alertas</span><b>${alerts.total}</b></div>
      </div>
      <div class="m-actions"><button class="m-btn" data-mobile-page-go="loja">Loja</button><button class="m-btn secondary" data-mobile-page-go="pedido">Novo pedido</button></div>
      <div class="m-card"><h3>Pedidos pendentes</h3><div class="m-list">${pendentes.slice(0, 5).map((p) => { const items = (p.items || []); const resumo = items.slice(0, 2).map((it) => `${it.qtd}x ${it.pizzaNome}`).join(" · ") + (items.length > 2 ? ` · +${items.length - 2} item(ns)` : ""); return `<div class="m-item"><div class="m-item-head"><b>${escapeHTML(p.cliente || "Cliente")}</b><span class="m-badge warn">${escapeHTML(p.status || "Pendente")}</span></div><div class="m-line">${escapeHTML(resumo)}</div><div class="m-line"><b>${formatCurrency(p.valorFinal || p.valorTotal || 0)}</b></div></div>`; }).join("") || `<p class="m-muted">Sem pedidos pendentes.</p>`}</div></div>
      <div class="m-card"><h3>Produzir agora</h3><div class="m-list">${prod.map((x) => `<div class="m-item"><div class="m-item-head"><b>${escapeHTML(x.pizza.nome)} (${escapeHTML(x.pizza.tamanho)})</b><span class="m-badge bad">${x.produzirPedidos}</span></div><div class="m-line">Pedidos: ${x.pedidos} · Estoque: ${x.estoque} · Sobra: ${x.sobra}</div></div>`).join("") || `<p class="m-muted">Nada urgente para produzir.</p>`}</div></div>
    </section>`);
  };

  const renderMobilePedido = () => {
    renderMobileShell(`<section class="m-section">
      <div class="m-card"><h2>Novo pedido</h2><p class="m-muted">Cadastro rápido otimizado para celular.</p></div>
      <div class="m-card"><form class="m-form" id="m-pedido-form">
        <input id="m-pedido-cliente" placeholder="Cliente" list="clientes-list" required>
        <input id="m-pedido-telefone" placeholder="Telefone">
        <input id="m-pedido-cidade" placeholder="Cidade" required>
        <input id="m-pedido-endereco" placeholder="Endereço">
        <input id="m-pedido-vendedor" placeholder="Vendedor" value="${escapeAttr(getMobileSellerName())}" required>
        <select id="m-pedido-pagamento"><option value="Pix">Pix</option><option value="Dinheiro">Dinheiro</option><option value="Cartão de Crédito">Cartão de Crédito</option><option value="Cartão de Débito">Cartão de Débito</option></select>
        <select id="m-pedido-semana">${mobileWeekOptionsHTML(24)}</select>
        <div class="m-two"><select id="m-pedido-pizza"><option value="">Pizza...</option>${mPizzaOptions()}</select><input id="m-pedido-qtd" type="number" min="1" value="1"></div>
        <button type="button" id="m-add-pizza" class="m-btn secondary">Adicionar pizza</button>
        <div id="m-pedido-carrinho" class="m-cart"></div>
        <input id="m-pedido-desconto" placeholder="Desconto %" inputmode="decimal">
        <input id="m-pedido-valor-final" placeholder="Valor final" inputmode="decimal">
        <div class="m-total-sticky"><span>Total</span><b id="m-pedido-total">R$ 0,00</b></div>
        <button type="button" id="m-pedido-pix" class="m-btn secondary">Gerar QR Pix</button>
        <div id="m-pedido-pix-box" class="m-pix-box"></div>
        <button type="submit" class="m-btn green">Registrar pedido</button>
      </form></div>
    </section>`);
    renderMobileOrderCart();
    updateMobileOrderTotal();
    const clienteInput = document.getElementById("m-pedido-cliente");
    clienteInput?.addEventListener("input", () => {
      const c = database.clientes.find((x) => (x.nome || "").toLowerCase() === clienteInput.value.toLowerCase());
      if (c) {
        document.getElementById("m-pedido-telefone").value = c.telefone || "";
        document.getElementById("m-pedido-cidade").value = c.cidade || "";
        document.getElementById("m-pedido-endereco").value = c.endereco || "";
      }
    });
    document.getElementById("m-pedido-pagamento")?.addEventListener("change", () => {
      const pagamento = document.getElementById("m-pedido-pagamento").value;
      mobileOrderItems = mobileOrderItems.map((it) => {
        const pizza = database.estoque.find((p) => p.id === it.pizzaId);
        return { ...it, preco: getPrecoPorPagamento(pizza?.precoVenda || it.preco, pagamento) };
      });
      renderMobileOrderCart(); updateMobileOrderTotal();
    });
    document.getElementById("m-add-pizza")?.addEventListener("click", () => {
      const pizzaId = document.getElementById("m-pedido-pizza").value;
      const qtd = parseInt(document.getElementById("m-pedido-qtd").value) || 1;
      const pizza = database.estoque.find((p) => p.id === pizzaId);
      if (!pizza) return alert("Selecione uma pizza.");
      const pagamento = document.getElementById("m-pedido-pagamento").value;
      const disponivel = getAvailableStockForPizza(pizzaId, mobileOrderItems);
      if (qtd > disponivel) {
        const seguir = confirm(`Estoque livre para ${pizza.nome}: ${disponivel}.

Lançar mesmo assim como encomenda/produção pendente?`);
        if (!seguir) return;
      }
      mobileOrderItems.push({ pizzaId, pizzaNome: `${pizza.nome} (${pizza.tamanho || ""})`, qtd, isCustom: false, preco: getPrecoPorPagamento(pizza.precoVenda, pagamento) });
      renderMobileOrderCart(); updateMobileOrderTotal();
    });
    document.getElementById("m-pedido-desconto")?.addEventListener("input", updateMobileOrderTotal);
    const finalInput = document.getElementById("m-pedido-valor-final");
    finalInput?.addEventListener("input", () => {
      finalInput.dataset.userEdited = "1";
      const pixBox = document.getElementById("m-pedido-pix-box");
      if (pixBox?.dataset.visible === "1") renderMobilePixPreview("m-pedido-pix-box", safeNumber(finalInput.value, 0), "Pix do pedido");
    });
    document.getElementById("m-pedido-pix")?.addEventListener("click", () => {
      const amount = safeNumber(document.getElementById("m-pedido-valor-final")?.value, applyDiscount(calcMobileOrderTotal(), document.getElementById("m-pedido-desconto")?.value));
      renderMobilePixPreview("m-pedido-pix-box", amount, "Pix do pedido");
    });
    document.getElementById("m-pedido-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!mobileOrderItems.length) return alert("Adicione pelo menos uma pizza.");
      await saveMobilePedido({
        cliente: document.getElementById("m-pedido-cliente").value.trim(),
        telefone: document.getElementById("m-pedido-telefone").value.trim(),
        cidade: document.getElementById("m-pedido-cidade").value.trim(),
        endereco: document.getElementById("m-pedido-endereco").value.trim(),
        vendedor: document.getElementById("m-pedido-vendedor").value.trim(),
        pagamento: document.getElementById("m-pedido-pagamento").value,
        dataEntrega: document.getElementById("m-pedido-semana").value,
        items: mobileOrderItems,
        valorTotal: calcMobileOrderTotal(),
        valorFinal: safeNumber(document.getElementById("m-pedido-valor-final").value, applyDiscount(calcMobileOrderTotal(), document.getElementById("m-pedido-desconto").value)),
      });
    });
  };

  const saveMobilePedido = async (pedidoData) => {
    if (!pedidoData.cliente || !pedidoData.cidade || !pedidoData.vendedor) {
      alert("Preencha cliente, cidade e vendedor.");
      return false;
    }
    showLoader();
    try {
      let cliente = database.clientes.find((c) => (c.nome || "").toLowerCase() === pedidoData.cliente.toLowerCase() && (c.cidade || "").toLowerCase() === pedidoData.cidade.toLowerCase());
      let clienteId = cliente?.id;
      if (!clienteId) {
        const r = await supabaseClient.from("clientes").insert({ nome: pedidoData.cliente, telefone: pedidoData.telefone, cidade: pedidoData.cidade, endereco: pedidoData.endereco }).select().single();
        if (r.error) throw r.error;
        clienteId = r.data.id;
      }
      const newPedido = { ...pedidoData, clienteId, status: "Pendente", pago: false };
      const r = await supabaseClient.rpc("criar_pedido_com_reserva", { p_pedido: newPedido });
      if (r.error) throw r.error;
      mobileOrderItems = [];
      showSaveStatus(r.data?.estoque_baixado ? "Pedido registrado pelo celular e estoque reservado." : "Pedido registrado pelo celular como encomenda/produção pendente.");
      await loadDataFromSupabase();
      if ((pedidoData.pagamento || "").toLowerCase() === "pix") {
        openMobilePixModal(pedidoData.valorFinal || pedidoData.valorTotal, pedidoData.cliente);
      }
      mobilePage = "inicio";
      renderMobileApp();
      return true;
    } catch (err) {
      showSaveStatus(formatSupabaseError(err, "Erro ao registrar pedido"), false);
      return false;
    } finally { hideLoader(); }
  };

  const renderMobileVenda = () => {
    const week = getWeekStart();
    const pagamento = "Pix";
    renderMobileShell(`<section class="m-section">
      <div class="m-card"><h2>Venda rápida</h2><p class="m-muted">Escolha as quantidades, confirme cliente e gere pedido.</p></div>
      <div class="m-card"><form class="m-form" id="m-venda-form">
        <input id="m-venda-cliente" placeholder="Cliente" list="clientes-list" required>
        <input id="m-venda-cidade" placeholder="Cidade" required>
        <input id="m-venda-vendedor" placeholder="Vendedor" value="${escapeAttr(getMobileSellerName())}" required>
        <select id="m-venda-pagamento"><option value="Pix">Pix</option><option value="Dinheiro">Dinheiro</option><option value="Cartão de Crédito">Cartão de Crédito</option><option value="Cartão de Débito">Cartão de Débito</option></select>
        <select id="m-venda-semana">${mobileWeekOptionsHTML(24)}</select>
        <input id="m-venda-busca-pizza" placeholder="Buscar pizza...">
        <div id="m-venda-pizzas" class="m-pizza-grid"></div>
        <div class="m-total-sticky"><span>Total</span><b id="m-venda-total">R$ 0,00</b></div>
        <button type="button" id="m-venda-pix" class="m-btn secondary">Gerar QR Pix</button>
        <div id="m-venda-pix-box" class="m-pix-box"></div>
        <button class="m-btn green" type="submit">Registrar venda</button>
      </form></div>
    </section>`);
    const renderRows = () => {
      const term = (document.getElementById("m-venda-busca-pizza")?.value || "").toLowerCase();
      const box = document.getElementById("m-venda-pizzas");
      if (!box) return;
      const pay = document.getElementById("m-venda-pagamento")?.value || pagamento;
      box.innerHTML = database.estoque.filter((p) => !term || (p.nome || "").toLowerCase().includes(term)).slice(0, 60).map((p) => {
        const qty = Number(mobileSaleItems[p.id] || 0);
        mobileSaleItems[p.id] = qty;
        return `<div class="m-pizza-row"><div><b>${escapeHTML(p.nome)} (${escapeHTML(p.tamanho)})</b><div class="m-line">Estoque ${p.qtd} · ${formatCurrency(getPrecoPorPagamento(p.precoVenda, pay))}</div></div><button type="button" class="m-mini-btn" data-pizza-minus="${p.id}">−</button><input type="number" min="0" value="${qty}" data-pizza-qty="${p.id}"><button type="button" class="m-mini-btn" data-pizza-plus="${p.id}">+</button></div>`;
      }).join("");
      box.querySelectorAll("[data-pizza-plus]").forEach((btn) => btn.onclick = () => {
        mobileSaleItems[btn.dataset.pizzaPlus] = Number(mobileSaleItems[btn.dataset.pizzaPlus] || 0) + 1;
        renderRows(); updateSaleTotal();
      });
      box.querySelectorAll("[data-pizza-minus]").forEach((btn) => btn.onclick = () => { mobileSaleItems[btn.dataset.pizzaMinus] = Math.max(0, Number(mobileSaleItems[btn.dataset.pizzaMinus] || 0) - 1); renderRows(); updateSaleTotal(); });
      box.querySelectorAll("[data-pizza-qty]").forEach((inp) => inp.oninput = () => {
        mobileSaleItems[inp.dataset.pizzaQty] = Math.max(0, parseInt(inp.value) || 0);
        inp.value = mobileSaleItems[inp.dataset.pizzaQty];
        updateSaleTotal();
      });
    };
    const updateSaleTotal = () => {
      const pay = document.getElementById("m-venda-pagamento")?.value || pagamento;
      const total = Object.entries(mobileSaleItems).reduce((acc, [id, q]) => {
        const pizza = database.estoque.find((p) => p.id === id);
        return acc + (pizza ? getPrecoPorPagamento(pizza.precoVenda, pay) * Number(q || 0) : 0);
      }, 0);
      const el = document.getElementById("m-venda-total"); if (el) el.textContent = formatCurrency(total);
      const pixBox = document.getElementById("m-venda-pix-box");
      if (pixBox?.dataset.visible === "1") renderMobilePixPreview("m-venda-pix-box", total, "Pix da venda");
    };
    renderRows(); updateSaleTotal();
    document.getElementById("m-venda-pix")?.addEventListener("click", () => {
      const pay = document.getElementById("m-venda-pagamento")?.value || pagamento;
      const total = Object.entries(mobileSaleItems).reduce((acc, [id, q]) => {
        const pizza = database.estoque.find((p) => p.id === id);
        return acc + (pizza ? getPrecoPorPagamento(pizza.precoVenda, pay) * Number(q || 0) : 0);
      }, 0);
      renderMobilePixPreview("m-venda-pix-box", total, "Pix da venda");
    });
    document.getElementById("m-venda-busca-pizza")?.addEventListener("input", renderRows);
    document.getElementById("m-venda-pagamento")?.addEventListener("change", () => { renderRows(); updateSaleTotal(); });
    document.getElementById("m-venda-cliente")?.addEventListener("input", (e) => {
      const c = database.clientes.find((x) => (x.nome || "").toLowerCase() === e.target.value.toLowerCase());
      if (c) document.getElementById("m-venda-cidade").value = c.cidade || "";
    });
    document.getElementById("m-venda-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pay = document.getElementById("m-venda-pagamento").value;
      const items = Object.entries(mobileSaleItems).filter(([,q]) => Number(q) > 0).map(([id,q]) => {
        const p = database.estoque.find((x) => x.id === id);
        return { pizzaId: id, pizzaNome: `${p.nome} (${p.tamanho || ""})`, qtd: Number(q), isCustom: false, preco: getPrecoPorPagamento(p.precoVenda, pay) };
      });
      if (!items.length) return alert("Selecione pelo menos uma pizza.");
      const valorTotal = items.reduce((a,it) => a + it.preco * it.qtd, 0);
      const saved = await saveMobilePedido({ cliente: document.getElementById("m-venda-cliente").value.trim(), telefone: "", cidade: document.getElementById("m-venda-cidade").value.trim(), endereco: "", vendedor: document.getElementById("m-venda-vendedor").value.trim(), pagamento: pay, dataEntrega: document.getElementById("m-venda-semana").value || week, items, valorTotal, valorFinal: valorTotal });
      if (saved) mobileSaleItems = {};
    });
  };

  const renderMobileProducao = () => {
    const week = getWeekStart();
    const data = getProductionSuggestion(week).filter((x) => x.produzirPedidos > 0 || x.produzirSugerido > 0);
    renderMobileShell(`<section class="m-section"><div class="m-card"><h2>Produção</h2><p class="m-muted">Semana atual. Quantidade grande = sugestão mais segura.</p></div><div class="m-list">${data.map((x) => `<div class="m-item"><div class="m-item-head"><b>${escapeHTML(x.pizza.nome)} (${escapeHTML(x.pizza.tamanho)})</b><span class="m-badge ${x.produzirPedidos > 0 ? 'bad' : 'warn'}">${Math.max(x.produzirPedidos, x.produzirSugerido)}</span></div><div class="m-line">Pedidos: ${x.pedidos} · Estoque: ${x.estoque} · Sobra: ${x.sobra} · Média: ${x.mediaAnterior.toFixed(1)}</div></div>`).join("") || `<div class="m-card"><p class="m-muted">Nada para produzir agora.</p></div>`}</div></section>`);
  };

  const renderMobileLoja = () => {
    const aguardando = database.pedidos
      .filter((p) => p.status === "Pendente")
      .sort((a, b) => `${a.dataEntrega || ""} ${a.horario_preferencia || ""}`.localeCompare(`${b.dataEntrega || ""} ${b.horario_preferencia || ""}`));
    const proximos = getLogisticaPedidos().slice(0, 8);
    renderMobileShell(`<section class="m-section">
      <div class="m-card"><h2>Loja</h2><p class="m-muted">Pedidos online e próximos atendimentos.</p></div>
      <div class="m-kpis">
        <div class="m-kpi"><span>A confirmar</span><b>${aguardando.length}</b></div>
        <div class="m-kpi"><span>Próximos</span><b>${proximos.length}</b></div>
      </div>
      <div class="m-card"><h3>Confirmações</h3><div class="m-list">${aguardando.slice(0, 10).map((p) => {
        const resumo = summarizeMobileItems(p.items, 2);
        return `<div class="m-item"><div class="m-item-head"><b>${escapeHTML(p.cliente || "Cliente")}</b><span class="m-badge warn">A confirmar</span></div><div class="m-line">${escapeHTML(getMetodoEntregaLabel(p))} · ${escapeHTML(formatPedidoAgenda(p))}</div><div class="m-line">${escapeHTML(resumo)}</div><div class="m-actions"><button class="m-mini-btn green" data-confirm-id="${p.id}">Confirmar</button><button class="m-mini-btn danger" data-reject-id="${p.id}">Rejeitar</button></div></div>`;
      }).join("") || `<p class="m-muted">Sem pedidos para confirmar.</p>`}</div></div>
      <div class="m-card"><h3>Próximas entregas e retiradas</h3><div class="m-list">${proximos.map((p) => `<div class="m-item"><div class="m-item-head"><b>${escapeHTML(p.cliente || "Cliente")}</b><span class="m-badge ${normalizeMetodoEntrega(p) === "entrega" ? "ok" : "muted"}">${escapeHTML(getMetodoEntregaLabel(p))}</span></div><div class="m-line">${escapeHTML(formatPedidoAgenda(p))} · ${escapeHTML(p.cidade || "-")}</div></div>`).join("") || `<p class="m-muted">Nada agendado.</p>`}</div></div>
    </section>`);
    document.querySelectorAll("[data-confirm-id]").forEach((btn) => btn.addEventListener("click", () => window.updatePedidoStatus(btn.dataset.confirmId, "Confirmado")));
    document.querySelectorAll("[data-reject-id]").forEach((btn) => btn.addEventListener("click", () => window.updatePedidoStatus(btn.dataset.rejectId, "Negado")));
  };

  const renderMobileMais = () => {
    const sobras = database.estoque.filter((p) => Number(p.qtd || 0) > 0).slice(0, 12);
    renderMobileShell(`<section class="m-section"><div class="m-card"><h2>Mais</h2><div class="m-actions single"><button class="m-btn secondary" id="m-open-profile">Perfil do vendedor</button><button class="m-btn secondary" data-mobile-page-go="venda">Venda rápida</button><button class="m-btn secondary" id="m-open-desktop-agenda">Agenda completa</button><button class="m-btn secondary" id="m-open-desktop-estoque">Sabores e estoque</button><button class="m-btn secondary" id="m-open-desktop-pedidos">Pedidos completos</button><button class="m-btn secondary" id="m-copy-sobras">Copiar disponíveis</button></div></div><div class="m-card"><h3>Disponíveis</h3><div class="m-list">${sobras.map((p) => `<div class="m-item"><div class="m-item-head"><b>${escapeHTML(p.nome)} (${escapeHTML(p.tamanho)})</b><span class="m-badge ok">${p.qtd}</span></div></div>`).join("") || `<p class="m-muted">Sem pizzas disponíveis.</p>`}</div></div></section>`);
    document.getElementById("m-open-profile")?.addEventListener("click", openSellerProfileModal);
    document.getElementById("m-open-desktop-pedidos")?.addEventListener("click", () => { document.body.classList.add('force-desktop-mobile'); openTab('pedidos'); });
    document.getElementById("m-open-desktop-agenda")?.addEventListener("click", () => { document.body.classList.add('force-desktop-mobile'); openTab('logistica'); });
    document.getElementById("m-open-desktop-estoque")?.addEventListener("click", () => { document.body.classList.add('force-desktop-mobile'); openTab('estoque'); });
    document.getElementById("m-copy-sobras")?.addEventListener("click", async () => {
      const msg = sobras.map((p) => `🍕 ${p.nome} (${p.tamanho}) — ${p.qtd} un.`).join("\n");
      await navigator.clipboard.writeText(msg || "Sem disponíveis no momento.");
      showSaveStatus("Lista copiada!");
    });
    document.querySelectorAll("[data-mobile-page-go]").forEach((btn) => btn.addEventListener("click", () => { mobilePage = btn.dataset.mobilePageGo; renderMobileApp(); }));
  };

  const renderMobileSearch = () => {
    const term = (document.getElementById("mobile-search")?.value || "").toLowerCase().trim();
    if (!term) return renderMobileInicio();
    const clientes = database.clientes.filter((c) => [c.nome,c.cidade,c.telefone].some((v) => String(v||"").toLowerCase().includes(term))).slice(0,8);
    const pedidos = database.pedidos.filter((p) => [p.cliente,p.cidade,p.vendedor,...(p.items||[]).map(i=>i.pizzaNome)].some((v) => String(v||"").toLowerCase().includes(term))).slice(0,8);
    const pizzas = database.estoque.filter((p) => [p.nome,p.tamanho].some((v) => String(v||"").toLowerCase().includes(term))).slice(0,8);
    renderMobileShell(`<section class="m-section"><div class="m-card"><h2>Busca</h2><p class="m-muted">Resultados para: <b>${escapeHTML(term)}</b></p></div><div class="m-card"><h3>Clientes</h3><div class="m-list">${clientes.map(c=>`<div class="m-item"><b>${escapeHTML(c.nome)}</b><div class="m-line">${escapeHTML(c.cidade||'')} · ${escapeHTML(c.telefone||'')}</div></div>`).join('') || '<p class="m-muted">Nenhum cliente.</p>'}</div></div><div class="m-card"><h3>Pedidos</h3><div class="m-list">${pedidos.map(p=>`<div class="m-item"><b>${escapeHTML(p.cliente)}</b><div class="m-line">${summarizeMobileItems(p.items, 3)}</div><div class="m-line">${formatCurrency(p.valorFinal||p.valorTotal||0)} · ${escapeHTML(p.status||'')}</div></div>`).join('') || '<p class="m-muted">Nenhum pedido.</p>'}</div></div><div class="m-card"><h3>Pizzas</h3><div class="m-list">${pizzas.map(p=>`<div class="m-item"><b>${escapeHTML(p.nome)} (${escapeHTML(p.tamanho)})</b><div class="m-line">Estoque ${p.qtd} · ${formatCurrency(p.precoVenda)}</div></div>`).join('') || '<p class="m-muted">Nenhuma pizza.</p>'}</div></div></section>`);
  };

  const renderMobileApp = () => {
    if (!document.getElementById("mobile-app")) return;
    const searchTerm = (document.getElementById("mobile-search")?.value || "").trim();
    if (searchTerm) return renderMobileSearch();
    if (mobilePage === "loja") return renderMobileLoja();
    if (mobilePage === "pedido") return renderMobilePedido();
    if (mobilePage === "venda") return renderMobileVenda();
    if (mobilePage === "producao") return renderMobileProducao();
    if (mobilePage === "mais") return renderMobileMais();
    return renderMobileInicio();
  };

  document.querySelectorAll(".mobile-app-nav button").forEach((btn) => btn.addEventListener("click", () => {
    mobilePage = btn.dataset.mobilePage;
    const search = document.getElementById("mobile-search");
    if (search) search.value = "";
    renderMobileApp();
  }));
  document.getElementById("mobile-home-brand")?.addEventListener("click", () => { mobilePage = "inicio"; renderMobileApp(); });
  document.getElementById("mobile-profile-btn")?.addEventListener("click", openSellerProfileModal);
  document.getElementById("mobile-search")?.addEventListener("input", () => renderMobileApp());
  window.addEventListener("resize", () => { if (isMobileViewport()) renderMobileApp(); });

  const hardFixMobileLayout = () => {
    if (window.innerWidth > 900) return;
    document.querySelectorAll(".mobile-bottom-nav").forEach((el) => {
      el.style.display = "none";
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
      el.style.width = "0";
      el.style.height = "0";
      el.style.maxHeight = "0";
      el.style.overflow = "hidden";
    });
    const app = document.getElementById("mobile-app");
    if (app) {
      app.style.display = "flex";
      app.style.position = "fixed";
      app.style.inset = "0";
      app.style.width = "100vw";
      app.style.maxWidth = "100vw";
      app.style.height = "100dvh";
      app.style.overflow = "hidden";
    }
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  };
  window.addEventListener("resize", hardFixMobileLayout);
  window.addEventListener("orientationchange", () => setTimeout(hardFixMobileLayout, 80));
  setTimeout(hardFixMobileLayout, 0);


  document.getElementById("loja-cal-cidade")?.addEventListener("input", () => {
    lojaCalendarSelectedDates.clear();
    lojaCalendarSelectedWeekdays.clear();
    renderLojaCalendario();
  });
  document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
    button.addEventListener("click", () => setLojaCalendarMode(button.dataset.calendarMode));
  });
  document.getElementById("loja-cal-prev")?.addEventListener("click", () => {
    lojaCalendarMonth.setMonth(lojaCalendarMonth.getMonth() - 1);
    lojaCalendarSelectedDates.clear();
    renderLojaCalendario();
  });
  document.getElementById("loja-cal-next")?.addEventListener("click", () => {
    lojaCalendarMonth.setMonth(lojaCalendarMonth.getMonth() + 1);
    lojaCalendarSelectedDates.clear();
    renderLojaCalendario();
  });
  document.getElementById("loja-cal-clear")?.addEventListener("click", () => {
    lojaCalendarSelectedDates.clear();
    renderLojaCalendarioGrade();
  });
  document.getElementById("loja-rec-clear")?.addEventListener("click", () => {
    lojaCalendarSelectedWeekdays.clear();
    renderLojaRecorrenciaPanel();
  });
  document.getElementById("loja-rec-save")?.addEventListener("click", async () => {
    const cidade = getLojaCalendarCity();
    if (!cidade) return showSaveStatus("Informe a cidade.", false);
    if (!lojaCalendarSelectedWeekdays.size) return showSaveStatus("Selecione pelo menos um dia da semana.", false);

    const cityKey = normalizeCidadeKey(cidade);
    const selected = [...lojaCalendarSelectedWeekdays].sort((a, b) => a - b);
    const existing = database.loja_entrega_recorrencia.filter((entry) => normalizeCidadeKey(entry.cidade) === cityKey && selected.includes(Number(entry.dia_semana)));
    const existingDays = new Set(existing.map((entry) => Number(entry.dia_semana)));
    const toInsert = selected.filter((dia_semana) => !existingDays.has(dia_semana));
    const toReactivate = existing.filter((entry) => entry.ativo === false).map((entry) => entry.id);

    if (!toInsert.length && !toReactivate.length) {
      lojaCalendarSelectedWeekdays.clear();
      renderLojaCalendario();
      return showSaveStatus("Essa recorrência já estava cadastrada.");
    }

    try {
      showLoader();
      if (toInsert.length) {
        const rows = toInsert.map((dia_semana) => ({ cidade, dia_semana, ativo: true }));
        const { error } = await supabaseClient.from("loja_entrega_recorrencia").insert(rows);
        if (error) throw error;
      }
      if (toReactivate.length) {
        const { error } = await supabaseClient.from("loja_entrega_recorrencia").update({ ativo: true }).in("id", toReactivate);
        if (error) throw error;
      }
      lojaCalendarSelectedWeekdays.clear();
      await loadDataFromSupabase();
      showSaveStatus("Recorrência salva.");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao salvar recorrência"), false);
    } finally {
      hideLoader();
    }
  });

  document.getElementById("loja-calendario-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const cidade = getLojaCalendarCity();
    if (!cidade) return showSaveStatus("Informe a cidade.", false);
    if (!lojaCalendarSelectedDates.size) return showSaveStatus("Selecione pelo menos um dia no calendário.", false);

    const cityKey = normalizeCidadeKey(cidade);
    const selected = [...lojaCalendarSelectedDates].sort();
    const existing = database.loja_entrega_calendario.filter((entry) => normalizeCidadeKey(entry.cidade) === cityKey && selected.includes(entry.data));
    const existingDates = new Set(existing.map((entry) => entry.data));
    const toInsert = selected.filter((date) => !existingDates.has(date));
    const toReactivate = existing.filter((entry) => entry.ativo === false).map((entry) => entry.id);

    if (!toInsert.length && !toReactivate.length) {
      lojaCalendarSelectedDates.clear();
      renderLojaCalendario();
      return showSaveStatus("Esses dias já estavam cadastrados.");
    }

    try {
      showLoader();
      if (toInsert.length) {
        const rows = toInsert.map((data) => ({
          data,
          cidade,
          periodo: "A combinar",
          hora_inicio: null,
          hora_fim: null,
          limite_pedidos: null,
          observacao: null,
          ativo: true,
        }));
        const { error } = await supabaseClient.from("loja_entrega_calendario").insert(rows);
        if (error) throw error;
      }
      if (toReactivate.length) {
        const { error } = await supabaseClient.from("loja_entrega_calendario").update({ ativo: true }).in("id", toReactivate);
        if (error) throw error;
      }
      lojaCalendarSelectedDates.clear();
      await loadDataFromSupabase();
      showSaveStatus("Dias de entrega salvos.");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao salvar calendário"), false);
    } finally {
      hideLoader();
    }
  });


  document.getElementById('loja-cupom-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('cupom-id')?.value || '';
    const payload = { codigo: normalizeCupomCodigo(document.getElementById('cupom-codigo')?.value), tipo: document.getElementById('cupom-tipo')?.value || 'percentual', valor: safeNumber(document.getElementById('cupom-valor')?.value, 0), minimo_pedido: safeNumber(document.getElementById('cupom-minimo')?.value, 0), inicio_em: document.getElementById('cupom-inicio')?.value || null, fim_em: document.getElementById('cupom-fim')?.value || null, uso_limite: document.getElementById('cupom-limite')?.value ? Number(document.getElementById('cupom-limite').value) : null, ativo: document.getElementById('cupom-ativo')?.checked !== false };
    if (!payload.codigo || payload.codigo.length < 3) return showSaveStatus('Informe um código com pelo menos 3 caracteres.', false);
    if (!payload.valor || payload.valor <= 0) return showSaveStatus('Informe o valor do desconto.', false);
    if (payload.tipo === 'percentual' && payload.valor > 100) return showSaveStatus('Percentual máximo: 100%.', false);
    try { showLoader(); const result = id ? await supabaseClient.from('loja_cupons').update(payload).eq('id', id) : await supabaseClient.from('loja_cupons').insert(payload); if (result.error) throw result.error; resetCupomForm(); await loadDataFromSupabase(); showSaveStatus('Cupom salvo.'); } catch (error) { showSaveStatus(formatSupabaseError(error, 'Não foi possível salvar o cupom'), false); } finally { hideLoader(); }
  });
  document.getElementById('cupom-limpar')?.addEventListener('click', resetCupomForm);
  document.getElementById('cupom-codigo')?.addEventListener('input', (event) => { event.target.value = normalizeCupomCodigo(event.target.value); });

  window.deleteLojaCalendario = async (id) => {
    if (!confirm("Remover esse dia de entrega?")) return;
    try {
      showLoader();
      const { error } = await supabaseClient.from("loja_entrega_calendario").delete().eq("id", id);
      if (error) throw error;
      await loadDataFromSupabase();
      showSaveStatus("Dia removido.");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao remover calendário"), false);
    } finally {
      hideLoader();
    }
  };

  window.toggleLojaCalendario = async (id, ativo) => {
    try {
      showLoader();
      const { error } = await supabaseClient.from("loja_entrega_calendario").update({ ativo }).eq("id", id);
      if (error) throw error;
      await loadDataFromSupabase();
      showSaveStatus(ativo ? "Dia ativado." : "Dia pausado.");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao atualizar calendário"), false);
    } finally {
      hideLoader();
    }
  };


  window.deleteLojaRecorrencia = async (id) => {
    if (!confirm("Remover essa recorrência?")) return;
    try {
      showLoader();
      const { error } = await supabaseClient.from("loja_entrega_recorrencia").delete().eq("id", id);
      if (error) throw error;
      await loadDataFromSupabase();
      showSaveStatus("Recorrência removida.");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao remover recorrência"), false);
    } finally {
      hideLoader();
    }
  };

  window.toggleLojaRecorrencia = async (id, ativo) => {
    try {
      showLoader();
      const { error } = await supabaseClient.from("loja_entrega_recorrencia").update({ ativo }).eq("id", id);
      if (error) throw error;
      await loadDataFromSupabase();
      showSaveStatus(ativo ? "Recorrência ativada." : "Recorrência pausada.");
    } catch (error) {
      showSaveStatus(formatSupabaseError(error, "Erro ao atualizar recorrência"), false);
    } finally {
      hideLoader();
    }
  };


loadDataFromSupabase();
});
