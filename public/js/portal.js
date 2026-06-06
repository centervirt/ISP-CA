document.addEventListener('DOMContentLoaded', () => {
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const btnLoginText = document.getElementById('btn-login-text');
    const btnLoginSpinner = document.getElementById('btn-login-spinner');
    const btnLogout = document.getElementById('btn-logout');

    // Revisar si ya hay una sesión activa al cargar la página
    const token = localStorage.getItem('portal_token');
    if (token) {
        cargarDashboard(token);
    }

    // Manejar el formulario de login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dni = document.getElementById('dni').value;
        const email = document.getElementById('email').value;

        // Mostrar spinner
        btnLoginText.classList.add('hidden');
        btnLoginSpinner.classList.remove('hidden');
        loginError.classList.add('hidden');

        try {
            const res = await fetch('/api/portal/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, email })
            });
            const data = await res.json();

            if (res.ok && data.status === 'success') {
                // Guardar token y cargar dashboard
                localStorage.setItem('portal_token', data.token);
                await cargarDashboard(data.token);
            } else {
                mostrarError(data.error || 'Error al iniciar sesión');
            }
        } catch (error) {
            mostrarError('Error de conexión. Intenta de nuevo.');
        } finally {
            // Restaurar botón
            btnLoginText.classList.remove('hidden');
            btnLoginSpinner.classList.add('hidden');
        }
    });

    // Cerrar sesión
    btnLogout.addEventListener('click', () => {
        localStorage.removeItem('portal_token');
        dashboardView.classList.add('hidden');
        dashboardView.classList.remove('flex');
        loginView.classList.remove('hidden');
        loginForm.reset();
    });

    function mostrarError(msg) {
        loginError.textContent = msg;
        loginError.classList.remove('hidden');
    }

    async function cargarDashboard(token) {
        try {
            const res = await fetch('/api/portal/dashboard', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.status === 401) {
                // Token expirado o inválido
                localStorage.removeItem('portal_token');
                loginView.classList.remove('hidden');
                return;
            }

            const data = await res.json();
            if (res.ok && data.status === 'success') {
                renderizarDashboard(data);
                
                // Cambiar vistas
                loginView.classList.add('hidden');
                dashboardView.classList.remove('hidden');
                dashboardView.classList.add('flex');
            }
        } catch (error) {
            console.error('Error cargando dashboard', error);
            mostrarError('Error al cargar los datos. Revisa tu conexión.');
            localStorage.removeItem('portal_token');
        }
    }

    function renderizarDashboard(data) {
        // Perfil
        document.getElementById('dash-nombre').textContent = data.perfil.nombre.split(' ')[0] || 'Cliente';
        const dir = data.perfil.direccion || data.perfil.direccion_principal || data.perfil.direccion_instalacion || '';
        document.getElementById('dash-direccion').textContent = dir ? dir : 'Sin dirección registrada';
        
        // Estado del Servicio
        const estadoBadge = document.getElementById('dash-estado-badge');
        const estadoTexto = document.getElementById('dash-estado-texto');
        
        const estadoRaw = String(data.perfil.estado || '').toLowerCase().trim();
        const estadoNum = parseInt(estadoRaw);
        
        if (estadoNum === 1 || estadoRaw === 'activo' || estadoRaw === 'active') {
            estadoBadge.textContent = 'ACTIVO';
            estadoBadge.className = 'px-3 py-1 text-xs font-bold rounded-full bg-green-100 text-green-700';
            estadoTexto.textContent = 'Servicio Operativo';
        } else if (estadoNum === 2 || estadoRaw === 'suspendido' || estadoRaw === 'cortado') {
            estadoBadge.textContent = 'SUSPENDIDO';
            estadoBadge.className = 'px-3 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700';
            estadoTexto.textContent = 'Servicio Cortado';
        } else {
            estadoBadge.textContent = 'INACTIVO';
            estadoBadge.className = 'px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700';
            estadoTexto.textContent = 'Fuera de Servicio';
        }

        // Finanzas
        const saldoFormat = Number(data.finanzas.saldoPendiente).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('dash-saldo').textContent = `$ ${saldoFormat}`;
        
        const facturas = data.finanzas.facturas || [];
        document.getElementById('dash-facturas-count').textContent = facturas.length === 1 ? '1 factura pendiente' : `${facturas.length} facturas pendientes`;
        
        const listDiv = document.getElementById('dash-facturas-list');
        listDiv.innerHTML = '';
        
        if (facturas.length === 0) {
            listDiv.innerHTML = `<div class="p-4 bg-green-50 text-green-700 rounded-xl text-sm text-center border border-green-100">¡Al día! No tienes deuda pendiente.</div>`;
            document.getElementById('btn-pagar-container').classList.add('hidden');
        } else {
            facturas.forEach(fac => {
                let fechaVenc = fac.vencimiento || fac.fecha_vencimiento || '';
                if (fechaVenc && fechaVenc.includes('-')) {
                    const p = fechaVenc.substring(0, 10).split('-');
                    fechaVenc = `${p[2]}/${p[1]}/${p[0]}`;
                }

                const facHtml = `
                    <div class="flex justify-between items-center p-3 bg-gray-50 border border-gray-100 rounded-xl">
                        <div>
                            <p class="font-semibold text-sm text-brand-navy">Factura #${fac.id}</p>
                            <p class="text-xs text-red-500 font-medium">Vence: ${fechaVenc}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-bold text-brand-navy">$ ${Number(fac.total).toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                        </div>
                    </div>
                `;
                listDiv.innerHTML += facHtml;
            });

            // Configurar boton de pago (Paga la factura más vieja/primera)
            const primeraFac = facturas[0];
            const btnContainer = document.getElementById('btn-pagar-container');
            btnContainer.classList.remove('hidden');
            btnContainer.innerHTML = `
                <button onclick="iniciarPago(${primeraFac.id}, ${primeraFac.total})" class="w-full bg-[#009ee3] text-white font-bold py-3 px-4 rounded-xl shadow-md hover:bg-[#0088c4] transition-colors flex justify-center items-center gap-2">
                    <span>💳 Pagar Próximo Vencimiento</span>
                </button>
            `;
        }

        // Historial de Facturas
        const historial = data.finanzas.historial || [];
        const histDiv = document.getElementById('dash-historial-list');
        if (histDiv) {
            histDiv.innerHTML = '';
            if (historial.length === 0) {
                histDiv.innerHTML = `<div class="p-4 bg-gray-50 text-gray-500 rounded-xl text-sm border border-gray-100 text-center">No hay facturas pagadas en el historial reciente.</div>`;
            } else {
                historial.forEach(fac => {
                    let fechaVenc = fac.vencimiento || fac.fecha_vencimiento || '';
                    if (fechaVenc && fechaVenc.includes('-')) {
                        const p = fechaVenc.substring(0, 10).split('-');
                        fechaVenc = `${p[2]}/${p[1]}/${p[0]}`;
                    }
                    const facHtml = `
                        <div class="flex justify-between items-center p-3 bg-gray-50 border border-gray-100 rounded-xl opacity-80">
                            <div>
                                <p class="font-semibold text-sm text-brand-navy">Factura #${fac.id}</p>
                                <p class="text-xs text-green-600 font-medium">Pagada - Venc. ${fechaVenc}</p>
                            </div>
                            <div class="text-right">
                                <p class="font-bold text-gray-400 line-through">$ ${Number(fac.total).toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                            </div>
                        </div>
                    `;
                    histDiv.innerHTML += facHtml;
                });
            }
        }
    }

    window.iniciarPago = async function(idfactura, monto) {
        const token = localStorage.getItem('portal_token');
        if (!token) return;

        // Efecto visual simple
        const btnContainer = document.getElementById('btn-pagar-container');
        btnContainer.innerHTML = `<div class="text-center p-3 text-brand-cobalt text-sm font-semibold">Conectando con Mercado Pago...</div>`;

        try {
            const res = await fetch('/api/portal/pagar', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ idfactura, monto })
            });
            const data = await res.json();
            
            if (res.ok && data.paymentUrl) {
                // Redirigir a Mercado Pago
                window.location.href = data.paymentUrl;
            } else {
                alert('Hubo un error al generar el link de pago.');
                cargarDashboard(token); // recargar
            }
        } catch (e) {
            alert('Error de conexión con Mercado Pago.');
            cargarDashboard(token);
        }
    };

});
