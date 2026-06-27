require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3005;

// Configuración de reintentos para el bot
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

// ============================================================
// MIDDLEWARES DE SEGURIDAD
// ============================================================

// 1. Helmet: configura cabeceras HTTP seguras automáticamente
//    Previene XSS, Clickjacking, MIME sniffing, etc.
app.use(helmet({
    contentSecurityPolicy: false // Deshabilitado para no romper el CSS/JS externo (Google Fonts, Tailwind CDN, etc.)
}));

// 2. CORS: solo permite peticiones desde el mismo dominio
const allowedOrigins = process.env.BASE_URL
    ? [process.env.BASE_URL, 'http://localhost:3005']
    : ['http://localhost:3005'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// 3. Rate Limiting Global: máximo 150 peticiones por IP cada 15 minutos
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', reply: 'Demasiadas peticiones. Por favor espera unos minutos e intenta de nuevo.' }
});
app.use(generalLimiter);

// 4. Rate Limiting Estricto para el Chat: máximo 40 mensajes por IP cada 10 minutos
const chatLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', reply: 'Has enviado demasiados mensajes. Por favor espera 10 minutos e intenta de nuevo.' }
});

// ============================================================
// Middleware para parsear JSON en las peticiones
app.use(express.json({ limit: '10kb' })); // Limitar tamaño de payload para evitar ataques

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Función auxiliar para realizar peticiones con reintentos hacia n8n
 */
async function axiosWithRetry(url, payload, headers, retries = MAX_RETRIES) {
    try {
        return await axios.post(url, payload, { headers, timeout: 60000 });
    } catch (error) {
        const isRetryable = !error.response || (error.response.status >= 500);
        
        if (retries > 0 && isRetryable) {
            const delay = RETRY_DELAY * (MAX_RETRIES - retries + 1);
            console.log(`[n8n Proxy] Error detectado. Reintentando en ${delay}ms... (Intentos restantes: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return axiosWithRetry(url, payload, headers, retries - 1);
        }
        throw error;
    }
}

// Endpoint de Chatbot (Proxy hacia n8n) — protegido con rate limiter estricto
app.post('/api/chat', chatLimiter, async (req, res) => {
    const { message, sessionId } = req.body;

    if (!message) {
        return res.status(400).json({ status: 'error', message: 'Message is required' });
    }

    // --- INTERCEPCIÓN NATIVA PARA MIKROWISP ---
    
    // 0. Verificamos si el usuario quiere SALIR
    if (message.trim().toLowerCase() === 'salir del chat' || message.trim().toLowerCase() === 'salir') {
        return res.json({
            status: 'success',
            reply: '¡Gracias por comunicarte con nosotros! Que tengas un excelente día. 👋',
            options: [], // Sin opciones para finalizar
            requireInput: false // Bloquea el campo de texto
        });
    }

    // 0.5. Verificamos si el usuario indica que hay un error y quiere reintentar
    if (message === 'REINTENTAR_DNI') {
        return res.json({
            status: 'success',
            reply: 'Entendido. Por favor, escribe los números de tu DNI nuevamente, sin puntos ni espacios:',
            options: [],
            requireInput: true
        });
    }

    // 3. Verificamos si quiere SOPORTE TÉCNICO
    if (message.trim().toLowerCase() === 'necesito soporte técnico' || message.trim().toLowerCase() === 'soporte') {
        // Activar modo soporte para este cliente (silenciar bot)
        if (from) {
            clientesEnSoporte[from] = { timestamp: Date.now() };
        }

        return res.json({
            status: 'success',
            reply: '⏳ *Te estamos transfiriendo con un agente de soporte humano.* \n\nPor favor, aguarda un momento, un operador te responderá por este mismo medio.\n\n_(Si deseas cancelar y volver al menú principal en cualquier momento, escribe "salir de soporte")_',
            options: [],
            requireInput: true
        });
    }

    // 0.6. Verificamos si quiere VOLVER AL MENÚ
    if (message.trim().toLowerCase() === 'volver al menú' || message.trim().toLowerCase() === 'menú' || message.trim().toLowerCase() === 'menu') {
        return res.json({
            status: 'success',
            reply: '¡Volvamos al inicio! Por favor, escribe los números de tu DNI para consultar tus datos:',
            options: [
                { label: "Salir", message: "Salir del chat" }
            ],
            requireInput: true
        });
    }

    // 0.7. Verificamos si quiere VENCIMIENTOS
    if (message.trim().toLowerCase() === 'vencimientos') {
        return res.json({
            status: 'success',
            reply: 'Te informamos que **los vencimientos de tu factura son el día 20 de cada mes**.\n\n¿En qué más te puedo ayudar?',
            options: [
                { label: "Volver al menú", message: "Volver al menú" },
                { label: "Salir", message: "Salir del chat" }
            ],
            requireInput: false
        });
    }

    // 0.8. Verificamos si quiere FORMAS DE PAGO
    if (message.trim().toLowerCase() === 'formas de pago') {
        return res.json({
            status: 'success',
            reply: '¿Qué método de pago preferís utilizar?',
            options: [
                { label: "💳 Mercado Pago", message: "FORMA_MERCADOPAGO" },
                { label: "🏦 Transferencia Bancaria", message: "FORMA_TRANSFERENCIA" },
                { label: "💵 Efectivo en Oficina", message: "FORMA_EFECTIVO" },
                { label: "🔙 Volver", message: "Volver al menú" }
            ],
            requireInput: false
        });
    }

    if (message === 'FORMA_MERCADOPAGO') {
        return res.json({
            status: 'success',
            reply: 'Para pagar con **Mercado Pago**, por favor utilizá la opción **Ver Saldo Pendiente** desde el menú principal. Allí encontrarás el link de pago exacto para tu factura.',
            options: [{ label: "Volver al menú", message: "Volver al menú" }],
            requireInput: false
        });
    }

    if (message === 'FORMA_TRANSFERENCIA') {
        const alias = process.env.BANK_ALIAS || 'TU.ALIAS';
        const cbu = process.env.BANK_CBU || '0000000000000000000000';
        const titular = process.env.BANK_HOLDER || 'Titular de la cuenta';
        const ws = process.env.SUPPORT_WHATSAPP || '5491100000000';
        const textWs = encodeURIComponent("Hola Soporte, adjunto mi comprobante de pago por transferencia.\nNombre: \nDirección: ");
        
        return res.json({
            status: 'success',
            reply: `Estos son nuestros datos bancarios:\n\n👤 **Titular:** ${titular}\n🏦 **CBU:** ${cbu}\n🔗 **Alias:** ${alias}\n\n⚠️ Una vez realizada la transferencia, es **obligatorio** enviar el comprobante indicando tu Nombre y Dirección para acreditar el pago.`,
            options: [
                { label: "📲 Enviar Comprobante", url: `https://wa.me/${ws}?text=${textWs}` },
                { label: "Volver al menú", message: "Volver al menú" }
            ],
            requireInput: false
        });
    }

    if (message === 'FORMA_EFECTIVO') {
        return res.json({
            status: 'success',
            reply: 'Podés abonar en efectivo acercándote a nuestra oficina central de Lunes a Viernes.\n\n📍 **Dirección:** [Actualizar en sistema]\n🕒 **Horarios:** [Actualizar en sistema]',
            options: [{ label: "Volver al menú", message: "Volver al menú" }],
            requireInput: false
        });
    }

    // 1. Verificamos si quiere VER SALDO (Paso 3)
    if (message.startsWith('VER_SALDO_DNI_')) {
        const dniSaldo = message.replace('VER_SALDO_DNI_', '').trim();
        console.log(`[Mikrowisp Native] Buscando deuda para DNI: ${dniSaldo}`);

        try {
            const mwUrl = `${process.env.MIKROWISP_URL}/api/v1`;
            const basePayload = { token: process.env.MIKROWISP_API_TOKEN };

            // A) Obtener ID de Cliente
            const clientRes = await axios.post(`${mwUrl}/GetClientsDetails`, { ...basePayload, cedula: dniSaldo }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });

            if (clientRes.data && clientRes.data.estado === 'exito' && clientRes.data.datos && clientRes.data.datos.length > 0) {
                const idcliente = clientRes.data.datos[0].id;

                // B) Buscar Facturas Pendientes (estado: 1)
                const invRes = await axios.post(`${mwUrl}/GetInvoices`, { ...basePayload, idcliente: idcliente, estado: 1 }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
                
                let facturas = invRes.data.facturas || [];
                if (!Array.isArray(facturas)) {
                    if (Array.isArray(invRes.data.datos)) facturas = invRes.data.datos;
                    else facturas = [];
                }

                // Ordenar por fecha de vencimiento (más antigua primero)
                facturas.sort((a, b) => {
                    const dateA = new Date(a.vencimiento || a.fecha_vencimiento || 0);
                    const dateB = new Date(b.vencimiento || b.fecha_vencimiento || 0);
                    return dateA - dateB;
                });

                let saldo = 0;
                let replyMensaje = '';
                let btnPagoText = "Pagar Factura";
                
                if (facturas.length > 0) {
                    // Sumar el total de todas las facturas pendientes
                    saldo = facturas.reduce((sum, fac) => sum + Number(fac.total || 0), 0);
                    const saldoFormateado = saldo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    
                    // Extraer fecha del vencimiento más próximo (la primera factura)
                    let fechaVenc = facturas[0].vencimiento || facturas[0].fecha_vencimiento || '';
                    if (fechaVenc && fechaVenc.includes('-') && fechaVenc.length >= 10) {
                        const partes = fechaVenc.substring(0, 10).split('-');
                        fechaVenc = `${partes[2]}/${partes[1]}/${partes[0]}`;
                    }

                    replyMensaje = `Tu saldo pendiente actual es de: **$ ${saldoFormateado}**.\n📅 **Vencimiento:** ${fechaVenc}\n\n¿Deseas realizar alguna otra gestión?`;
                    
                    if (facturas.length > 1) {
                        replyMensaje = `Tenés **${facturas.length} facturas pendientes** (Deuda total: $ ${saldoFormateado}).\n⚠️ Por normativas del sistema, debes abonar la factura más antigua primero.\n\n📅 **Vencimiento más antiguo:** ${fechaVenc}\n\n¿Deseas realizar el pago?`;
                        btnPagoText = "Pagar Factura Más Antigua";
                    }
                } else {
                    replyMensaje = `¡Felicidades! 🎉 No tienes facturas pendientes, tu saldo es **$ 0,00**.\n\n¿Deseas realizar alguna otra gestión?`;
                }
                
                let options = [];
                if (facturas.length > 0) {
                    options.push({ label: btnPagoText, message: `PAGAR_FACTURA_DNI_${dniSaldo}` });
                }
                options.push({ label: "Vencimientos", message: "Vencimientos" });
                options.push({ label: "Formas de pago", message: "Formas de pago" });
                options.push({ label: "Volver al menú", message: "Volver al menú" });
                
                return res.json({
                    status: 'success',
                    reply: replyMensaje,
                    options: options,
                    requireInput: false
                });
            }
        } catch (error) {
            console.error('[Mikrowisp Native] Error al consultar saldo:', error.message);
        }
        
        return res.json({
            status: 'error',
            reply: 'Hubo un error al consultar tu saldo. Intenta nuevamente más tarde.',
            options: ["Volver al menú"],
            requireInput: false
        });
    }

    // 2. Verificamos si es una CONFIRMACIÓN de DNI (Paso 2)
    if (message.startsWith('CONFIRMAR_DNI_')) {
        const dniConfirmado = message.replace('CONFIRMAR_DNI_', '').trim();
        
        return res.json({
            status: 'success',
            reply: `¡Datos confirmados con éxito! ✅\n\n¿Qué gestión deseas realizar en tu cuenta?`,
            options: [
                { label: "Ver Saldo Pendiente", message: `VER_SALDO_DNI_${dniConfirmado}` },
                { label: "Vencimientos", message: "Vencimientos" },
                { label: "Formas de pago", message: "Formas de pago" }
            ],
            requireInput: false
        });
    }

    // 2.5 Verificamos si quiere PAGAR FACTURA con Mercado Pago
    if (message.startsWith('PAGAR_FACTURA_DNI_')) {
        const dniPago = message.replace('PAGAR_FACTURA_DNI_', '').trim();
        console.log(`[MercadoPago] Generando link para DNI: ${dniPago}`);

        if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
            return res.json({ status: 'error', reply: 'El módulo de pagos no está configurado (Falta Token).', options: ["Volver al menú"], requireInput: false });
        }

        try {
            const mwUrl = `${process.env.MIKROWISP_URL}/api/v1`;
            const basePayload = { token: process.env.MIKROWISP_API_TOKEN };

            // A) Obtener ID de Cliente
            const clientRes = await axios.post(`${mwUrl}/GetClientsDetails`, { ...basePayload, cedula: dniPago }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
            
            if (clientRes.data && clientRes.data.estado === 'exito' && clientRes.data.datos && clientRes.data.datos.length > 0) {
                const idcliente = clientRes.data.datos[0].id;
                
                // B) Buscar Facturas Pendientes (estado: 1 = no pagadas)
                const invRes = await axios.post(`${mwUrl}/GetInvoices`, { ...basePayload, idcliente: idcliente, estado: 1 }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
                
                let facturas = invRes.data.facturas || [];
                if (!Array.isArray(facturas)) {
                    if (Array.isArray(invRes.data.datos)) facturas = invRes.data.datos;
                    else facturas = [];
                }

                // Ordenar por fecha de vencimiento (más antigua primero)
                facturas.sort((a, b) => {
                    const dateA = new Date(a.vencimiento || a.fecha_vencimiento || 0);
                    const dateB = new Date(b.vencimiento || b.fecha_vencimiento || 0);
                    return dateA - dateB;
                });

                if (facturas.length > 0) {
                    const factura = facturas[0]; 
                    const idfactura = factura.id;
                    const monto = Number(factura.total);
                    
                    // Formato del monto (ej: 10.000,00)
                    const montoFormateado = monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    
                    // Extraer y formatear la fecha de vencimiento (de YYYY-MM-DD a DD/MM/YYYY)
                    let fechaVenc = factura.vencimiento || factura.fecha_vencimiento || '';
                    if (fechaVenc && fechaVenc.includes('-') && fechaVenc.length >= 10) {
                        const partes = fechaVenc.substring(0, 10).split('-');
                        fechaVenc = `${partes[2]}/${partes[1]}/${partes[0]}`;
                    }

                    // C) Crear Preferencia en Mercado Pago
                    const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
                    const preference = new Preference(mpClient);

                    const body = {
                        items: [
                            {
                                id: `INV-${idfactura}`,
                                title: `Factura ${idfactura} - Internet`,
                                quantity: 1,
                                unit_price: monto,
                                currency_id: 'ARS'
                            }
                        ],
                        external_reference: `${idfactura}|${monto}|${idcliente}`
                    };

                    // Si configuraste BASE_URL en el .env, le decimos a MP a dónde enviar el Webhook
                    if (process.env.BASE_URL) {
                        body.notification_url = `${process.env.BASE_URL}/api/mercadopago/webhook`;
                    }

                    const result = await preference.create({ body });
                    
                    let replyMensaje = `Hemos generado tu orden de pago seguro por el monto de **$ ${montoFormateado}** (Factura #${idfactura}).`;
                    if (fechaVenc) {
                        replyMensaje = `Hemos generado tu orden de pago seguro por el monto de **$ ${montoFormateado}** (Factura #${idfactura}).\n📅 **Vencimiento:** ${fechaVenc}`;
                    }
                    
                    return res.json({
                        status: 'success',
                        reply: replyMensaje,
                        paymentUrl: result.init_point,
                        options: ["Volver al menú"],
                        requireInput: false
                    });
                } else {
                    return res.json({
                        status: 'success',
                        reply: `¡Buenas noticias! 🎉 No tienes ninguna factura pendiente de pago en este momento.`,
                        options: ["Volver al menú"],
                        requireInput: false
                    });
                }
            }
        } catch (error) {
            console.error('[MercadoPago] Error:', error.message);
        }

        return res.json({
            status: 'error',
            reply: 'Hubo un error al conectar con la pasarela de pagos. Por favor intenta más tarde.',
            options: ["Volver al menú"],
            requireInput: false
        });
    }

    // 3. Si el mensaje es solo números (Paso 1: Búsqueda inicial de DNI)
    const isDNI = /^\d{6,11}$/.test(message.trim());

    if (isDNI) {
        const dni = message.trim();
        console.log(`[Mikrowisp Native] Buscando DNI: ${dni}`);

        if (!process.env.MIKROWISP_URL || !process.env.MIKROWISP_API_TOKEN) {
            console.error('[Mikrowisp Native] Error: MIKROWISP_URL o MIKROWISP_API_TOKEN no configurados en .env');
            return res.json({
                status: 'error',
                reply: 'El sistema no está configurado para buscar deudas. Por favor, configura las variables en el archivo .env',
                options: ["Volver al menú"],
                requireInput: false
            });
        }

        try {
            const mwUrl = `${process.env.MIKROWISP_URL}/api/v1/GetClientsDetails`;
            
            // Enviamos en formato JSON estricto como lo usa la librería oficial
            const payload = {
                token: process.env.MIKROWISP_API_TOKEN,
                cedula: dni
            };

            const mwResponse = await axios.post(mwUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });

            // Mikrowisp devuelve un arreglo 'datos' cuando encuentra al cliente
            if (mwResponse.data && mwResponse.data.estado === 'exito' && mwResponse.data.datos && mwResponse.data.datos.length > 0) {
                const clienteInfo = mwResponse.data.datos[0];
                const clienteNombre = clienteInfo.nombre || 'Cliente';
                
                return res.json({
                    status: 'success',
                    reply: `Encontramos los siguientes datos:\n👤 Titular: **${clienteNombre}**\n\n¿Los datos de tu cuenta son correctos?`,
                    options: [
                        { label: "Sí, son correctos", message: `CONFIRMAR_DNI_${dni}` },
                        { label: "No, es un error", message: "REINTENTAR_DNI" },
                        { label: "Salir del chat", message: "Salir del chat" }
                    ],
                    requireInput: false
                });
            } else {
                return res.json({
                    status: 'success',
                    reply: `Lo siento, no encontré ningún cliente asociado al DNI **${dni}**. Verifica que esté bien escrito o que sea el titular.`,
                    options: [
                        { label: "Volver al menú", message: "Volver al menú" },
                        { label: "Salir", message: "Salir del chat" }
                    ],
                    requireInput: true
                });
            }
        } catch (error) {
            console.error('[Mikrowisp Native] Error de conexión:', error.message);
            return res.json({
                status: 'error',
                reply: 'Hubo una demora al conectar con el sistema de facturación. Intenta en unos minutos.',
                options: ["Volver al menú"],
                requireInput: false
            });
        }
    }
    // --- FIN INTERCEPCIÓN ---

    const n8nPayload = {
        message,
        chatInput: message,
        sessionId: sessionId || 'invitado',
        idcliente: 'invitado',
        timestamp: new Date().toISOString(),
        source: 'portal_web'
    };

    const headers = { 
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': process.env.ADMIN_PASSWORD || ''
    };

    try {
        console.log(`[n8n Proxy] Enviando mensaje a n8n: "${message}" (Session: ${n8nPayload.sessionId})`);
        
        if (!process.env.N8N_CHAT_WEBHOOK_URL) {
            throw new Error('N8N_CHAT_WEBHOOK_URL no está configurado en .env');
        }

        const response = await axiosWithRetry(process.env.N8N_CHAT_WEBHOOK_URL, n8nPayload, headers);

        let replyText = "Entiendo. ¿Podrías darme más detalles sobre eso?";
        let options = null;
        let requireInput = true;

        if (response.data) {
            // Si n8n envía un JSON completo con la nueva estructura
            if (response.data.reply) {
                replyText = response.data.reply;
                options = response.data.options || null;
                requireInput = response.data.requireInput !== undefined ? response.data.requireInput : true;
            } 
            // Fallback para estructura vieja (solo texto)
            else if (response.data.output || response.data.response || response.data.message) {
                replyText = response.data.output || response.data.response || response.data.message;
            } else if (typeof response.data === 'string') {
                replyText = response.data;
            }
        }

        return res.json({
            status: 'success',
            reply: replyText,
            options: options,
            requireInput: requireInput
        });

    } catch (error) {
        console.error('ERROR EN CHAT PROXY (n8n):', error.message);
        
        let errorMessage = 'Lo siento, estoy teniendo una pequeña demora en procesar tu consulta.';
        
        if (error.response && error.response.status === 500) {
            errorMessage = "Mi motor de inteligencia está en mantenimiento momentáneo. ¿Puedo ayudarte con alguna de las opciones de la web?";
        }
        
        res.json({ 
            status: 'error', 
            reply: errorMessage,
            isMaintenance: true
        });
    }
});

// ============================================
// WEBHOOK: MERCADO PAGO
// ============================================
app.post('/api/mercadopago/webhook', async (req, res) => {
    try {
        const body = req.body;
        const query = req.query;
        
        const type = body.type || query.type || query.topic;
        const resourceId = query.id || (body.data ? body.data.id : null);

        if (type === 'payment' && resourceId) {
            const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
            const payment = new Payment(mpClient);
            const paymentInfo = await payment.get({ id: resourceId });

            if (paymentInfo.status === 'approved' && paymentInfo.external_reference) {
                // Parseamos los datos que inyectamos al generar el link
                const parts = String(paymentInfo.external_reference).split('|');
                const idfactura = parts[0];
                const montoOriginal = parts[1] ? Number(parts[1]) : paymentInfo.transaction_amount;

                // Payload exacto requerido por Mikrowisp para registrar el pago
                const mikrowispPayload = {
                    token: process.env.MIKROWISP_API_TOKEN,
                    idfactura: Number(idfactura),
                    pasarela: 'Mercado Pago',
                    cantidad: montoOriginal,
                    comision: 0,
                    idtransaccion: String(resourceId),
                    fecha: new Date().toISOString().replace('T', ' ').substring(0, 19)
                };

                const mwUrl = `${process.env.MIKROWISP_URL}/api/v1/PaidInvoice`;
                await axios.post(mwUrl, mikrowispPayload, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
                console.log(`✅ [MercadoPago] Pago APROBADO. Factura ${idfactura} marcada como pagada en Mikrowisp. (Transacción: ${resourceId})`);
            }
        }
    } catch (error) {
        console.error('❌ [MercadoPago Webhook] Error procesando notificación:', error.message);
    }
    
    // Siempre responder 200 OK a Mercado Pago rápidamente para que no reintente
    res.status(200).send('OK');
});

// ============================================
// PORTAL CLIENTE NATIVO API
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-portal-ca';

// Middleware de Autenticación
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
    
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Formato de token inválido' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

// 1. LOGIN (Validar DNI y Email)
app.post('/api/portal/login', async (req, res) => {
    const { dni, email } = req.body;
    if (!dni || !email) return res.status(400).json({ error: 'DNI y Email son requeridos' });

    try {
        const mwUrl = `${process.env.MIKROWISP_URL}/api/v1/GetClientsDetails`;
        const payload = { token: process.env.MIKROWISP_API_TOKEN, cedula: dni };
        
        const mwResponse = await axios.post(mwUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        const data = mwResponse.data;

        if (data && data.estado === 'exito' && data.datos && data.datos.length > 0) {
            const cliente = data.datos[0];
            const clienteEmail = (cliente.email || '').trim().toLowerCase();
            const inputEmail = email.trim().toLowerCase();

            // Validación flexible: Si en Mikrowisp no hay email registrado, 
            // permitimos el ingreso solo con el DNI (asumiendo que el cliente está actualizando/proveyendo su email ahora).
            if (!clienteEmail || clienteEmail === inputEmail) {
                // Generar Token JWT
                const token = jwt.sign({ 
                    idcliente: cliente.id, 
                    dni: cliente.cedula,
                    nombre: cliente.nombre,
                    email: cliente.email
                }, JWT_SECRET, { expiresIn: '24h' });

                return res.json({ 
                    status: 'success', 
                    token, 
                    cliente: { 
                        nombre: cliente.nombre, 
                        email: cliente.email,
                        direccion: cliente.direccion,
                        estado: cliente.estado
                    } 
                });
            } else {
                return res.status(401).json({ error: 'El email no coincide con nuestros registros para este DNI.' });
            }
        }
        return res.status(404).json({ error: 'No se encontró un cliente con ese DNI.' });
    } catch (error) {
        console.error('Error en portal login:', error.message);
        res.status(500).json({ error: 'Error interno al validar credenciales.' });
    }
});

// 2. DASHBOARD (Obtener datos y facturas)
app.get('/api/portal/dashboard', authMiddleware, async (req, res) => {
    const { dni, idcliente } = req.user;
    try {
        // Pedir detalles del cliente actualizados
        const mwUrlClient = `${process.env.MIKROWISP_URL}/api/v1/GetClientsDetails`;
        const payloadClient = { token: process.env.MIKROWISP_API_TOKEN, cedula: dni };
        const clientResp = await axios.post(mwUrlClient, payloadClient, { headers: { 'Content-Type': 'application/json' } });
        
        let clienteDatos = null;
        if (clientResp.data.estado === 'exito' && clientResp.data.datos.length > 0) {
            clienteDatos = clientResp.data.datos[0];
        }

        // 1. Pedir facturas pendientes (estado: 1)
        const mwUrlInv = `${process.env.MIKROWISP_URL}/api/v1/GetInvoices`;
        const payloadInv = { token: process.env.MIKROWISP_API_TOKEN, idcliente: idcliente, estado: 1 };
        const invResp = await axios.post(mwUrlInv, payloadInv, { headers: { 'Content-Type': 'application/json' } });
        
        let facturas = [];
        let saldoTotal = 0;

        if (invResp.data.estado === 'exito') {
            let list = invResp.data.facturas || invResp.data.datos || [];
            if (Array.isArray(list)) {
                facturas = list;
                // Ordenar por fecha de vencimiento (más antigua primero)
                facturas.sort((a, b) => {
                    const dateA = new Date(a.vencimiento || a.fecha_vencimiento || 0);
                    const dateB = new Date(b.vencimiento || b.fecha_vencimiento || 0);
                    return dateA - dateB;
                });
                saldoTotal = facturas.reduce((sum, fac) => sum + Number(fac.total || 0), 0);
            }
        }

        // 2. Pedir TODAS las facturas (sin filtro de estado) para inspeccionarlas
        const payloadPaid = { token: process.env.MIKROWISP_API_TOKEN, idcliente: idcliente };
        const paidResp = await axios.post(mwUrlInv, payloadPaid, { headers: { 'Content-Type': 'application/json' } });
        
        let historial = [];
        if (paidResp.data.estado === 'exito') {
            let listAll = paidResp.data.facturas || paidResp.data.datos || [];
            if (Array.isArray(listAll) && listAll.length > 0) {
                // Filtrar las que NO sean pendientes (estado != 1, o que tengan monto pagado)
                historial = listAll.filter(fac => fac.estado !== 1 && fac.estado !== '1');
            }
        }

        res.json({
            status: 'success',
            perfil: clienteDatos,
            finanzas: {
                saldoPendiente: saldoTotal,
                facturas: facturas,
                historial: historial
            }
        });
    } catch (error) {
        console.error('Error obteniendo dashboard:', error.message);
        res.status(500).json({ error: 'Error al obtener los datos del portal.' });
    }
});

// 3. PAGAR DESDE EL PORTAL
app.post('/api/portal/pagar', authMiddleware, async (req, res) => {
    const { idfactura, monto } = req.body;
    const { idcliente } = req.user;
    if(!idfactura || !monto) return res.status(400).json({error: 'Datos de factura insuficientes'});

    try {
        const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
        const preference = new Preference(mpClient);

        const body = {
            items: [
                {
                    id: `INV-${idfactura}`,
                    title: `Factura ${idfactura} - Internet`,
                    quantity: 1,
                    unit_price: Number(monto),
                    currency_id: 'ARS'
                }
            ],
            external_reference: `${idfactura}|${monto}|${idcliente}`
        };

        if (process.env.BASE_URL) {
            body.notification_url = `${process.env.BASE_URL}/api/mercadopago/webhook`;
        }

        const result = await preference.create({ body });
        res.json({ status: 'success', paymentUrl: result.init_point });
    } catch (err) {
        console.error('Error MP Portal:', err.message);
        res.status(500).json({ error: 'No se pudo conectar con Mercado Pago' });
    }
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
