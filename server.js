require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');

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

// Iniciar Servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
