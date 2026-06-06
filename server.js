require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3005;

// Configuración de reintentos para el bot
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

// Middleware para parsear JSON en las peticiones
app.use(express.json());

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

// Endpoint de Chatbot (Proxy hacia n8n)
app.post('/api/chat', async (req, res) => {
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

                let saldo = 0;
                let replyMensaje = '';
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
                } else {
                    replyMensaje = `¡Felicidades! 🎉 No tienes facturas pendientes, tu saldo es **$ 0,00**.\n\n¿Deseas realizar alguna otra gestión?`;
                }
                
                return res.json({
                    status: 'success',
                    reply: replyMensaje,
                    options: [
                        { label: "Pagar Factura", message: `PAGAR_FACTURA_DNI_${dniSaldo}` },
                        { label: "Soporte Técnico", message: "Necesito soporte técnico" },
                        { label: "Volver al menú", message: "Volver al menú" }
                    ],
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
                { label: "Pagar Factura", message: `PAGAR_FACTURA_DNI_${dniConfirmado}` },
                { label: "Soporte Técnico", message: "Necesito soporte técnico" }
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
            options: ["Soporte Técnico", "Volver al menú"],
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
                options: ["Soporte Técnico"],
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
                        { label: "Soporte Técnico", message: "Necesito soporte técnico" },
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
                options: ["Soporte Técnico", "Volver al menú"],
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

// Iniciar Servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
