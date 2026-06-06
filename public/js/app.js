document.addEventListener('DOMContentLoaded', () => {

    /* --- Lógica del menú móvil --- */
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navbarMenu = document.getElementById('navbar-menu');

    if (mobileMenuBtn && navbarMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            navbarMenu.classList.toggle('hidden');
        });
    }
    /* --- Lógica del Chat --- */
    const chatButton = document.getElementById('chat-button');
    const chatContainer = document.getElementById('chat-container');
    const closeChatButton = document.getElementById('close-chat-button');
    const chatLog = document.getElementById('chat-log');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');

    if (chatButton) {
        chatButton.addEventListener('click', () => {
            chatContainer.style.display = 'flex';
        });

        // Nuevo: Abrir chat desde el navbar
        const navAssistantLink = document.getElementById('nav-assistant-link');
        if (navAssistantLink) {
            navAssistantLink.addEventListener('click', (e) => {
                e.preventDefault();
                chatContainer.style.display = 'flex';
                // Opcional: Focus en el input del chat
                if (chatInput) chatInput.focus();
            });
        }

        closeChatButton.addEventListener('click', () => {
            chatContainer.style.display = 'none';
            // Borrar la memoria de la sesión (para que n8n arranque de cero la próxima vez)
            localStorage.removeItem('chatSessionId');
            
            // Limpiar visualmente el chat log y reestablecer el mensaje inicial
            chatLog.innerHTML = `
            <div class="message bot self-start bg-gray-100 text-brand-navy p-3 rounded-2xl rounded-tl-sm text-sm font-sans max-w-[85%] shadow-sm">
                Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?
            </div>`;
            
            // Re-agregar los botones de consulta rápida
            if (typeof appendQuickActions === 'function') {
                appendQuickActions();
            }
        });

        sendButton.addEventListener('click', sendMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    async function sendMessage() {
        const userMessage = chatInput.value.trim();
        if (userMessage === '') return;

        // Mostrar el mensaje del usuario en el chat
        const userMessageDiv = document.createElement('div');
        userMessageDiv.className = 'message user';
        userMessageDiv.textContent = userMessage;
        chatLog.appendChild(userMessageDiv);
        chatInput.value = '';
        chatLog.scrollTop = chatLog.scrollHeight;

        // Simular respuesta del bot
        const botMessageDiv = document.createElement('div');
        botMessageDiv.className = 'message bot';
        botMessageDiv.textContent = 'Escribiendo...';
        chatLog.appendChild(botMessageDiv);
        
        // Quitar sugerencias previas al enviar nuevo mensaje
        const oldActions = chatLog.querySelectorAll('.quick-actions');
        oldActions.forEach(el => el.remove());
        
        chatLog.scrollTop = chatLog.scrollHeight;

        // Enviar la petición a nuestro backend (Proxy n8n)
        const API_URL = "/api/chat";
        // Generar un ID de sesión simple o usar uno existente
        const sessionId = localStorage.getItem('chatSessionId') || `session_${Math.random().toString(36).substring(2, 15)}`;
        localStorage.setItem('chatSessionId', sessionId);

        const payload = {
            message: userMessage,
            sessionId: sessionId
        };

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                // Soporte básico para negritas y saltos de línea
                const formattedReply = result.reply
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br>');
                botMessageDiv.innerHTML = formattedReply;

                // Si hay un link de pago, renderizar el botón de Mercado Pago
                if (result.paymentUrl) {
                    const mpContainer = document.createElement('div');
                    mpContainer.className = 'mt-3';
                    const mpButton = document.createElement('a');
                    mpButton.href = result.paymentUrl;
                    mpButton.target = '_blank';
                    
                    // Forzamos el color de fondo con CSS nativo para que nunca falle (independiente de Tailwind)
                    mpButton.style.backgroundColor = '#009ee3';
                    mpButton.style.color = '#ffffff';
                    mpButton.style.display = 'block';
                    
                    mpButton.className = 'text-sm font-bold py-3 px-4 rounded-lg shadow-md hover:opacity-80 transition-opacity decoration-none w-full text-center';
                    mpButton.innerHTML = '💳 Pagar con Mercado Pago';
                    mpContainer.appendChild(mpButton);
                    botMessageDiv.appendChild(mpContainer);
                }

                // Controlar el modo de input
                toggleInputMode(result.requireInput);
            } else {
                botMessageDiv.textContent = result.reply || 'Lo siento, no pude procesar tu mensaje. Intenta de nuevo.';
                if (result.isMaintenance) {
                    botMessageDiv.classList.add('text-red-500'); // Opcional para destacar
                }
            }
            
            // Mostrar opciones rápidas dinámicas (o las por defecto)
            if (result.status === 'success') {
                appendQuickActions(result.options);
            }
            
        } catch (error) {
            console.error('Error de red al contactar al backend:', error);
            botMessageDiv.textContent = 'Hubo un error de conexión. Por favor, revisa tu internet o intenta de nuevo.';
        } finally {
            chatLog.scrollTop = chatLog.scrollHeight;
        }
    }

    // Controlar si el usuario puede escribir o no
    function toggleInputMode(requireInput) {
        const inputContainer = document.getElementById('chat-input-container');
        if (requireInput === false) {
            chatInput.disabled = true;
            chatInput.placeholder = 'Selecciona una opción arriba...';
            sendButton.disabled = true;
            sendButton.classList.add('opacity-50');
        } else {
            chatInput.disabled = false;
            chatInput.placeholder = 'Escribe tu mensaje...';
            sendButton.disabled = false;
            sendButton.classList.remove('opacity-50');
            chatInput.focus();
        }
    }

    // Función para mostrar tarjetas de consulta rápida en el chat
    function appendQuickActions(dynamicOptions) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'quick-actions flex flex-wrap gap-2 mt-2';
        
        let actions = [];
        
        if (dynamicOptions && Array.isArray(dynamicOptions) && dynamicOptions.length > 0) {
            // Convertir strings a objetos si n8n envía solo un array de textos
            actions = dynamicOptions.map(opt => {
                if (typeof opt === 'string') {
                    return { label: opt, message: opt };
                }
                return opt;
            });
        } else if (!dynamicOptions) {
            // Fallback: Menú principal por defecto si n8n no envía nada (o al abrir el chat)
            actions = [
                { label: 'Pagar mi factura', message: 'Quiero pagar mi factura' },
                { label: 'Soporte Técnico', message: 'Necesito soporte técnico' },
                { label: 'Promesa de pago', message: 'Solicitar promesa de pago' }
            ];
            // Asegurarse de que el input esté deshabilitado en el menú principal
            toggleInputMode(false);
        }

        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = 'bg-white border border-brand-lightblue/50 text-brand-cobalt text-xs font-semibold py-2 px-4 rounded-full hover:bg-gradient-to-r hover:from-brand-cobalt hover:to-brand-lightblue hover:text-white hover:border-transparent transition-all shadow-sm hover:shadow-md transform hover:-translate-y-0.5 animate-fade-in-up';
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                chatInput.value = action.message;
                sendMessage();
            });
            actionsContainer.appendChild(btn);
        });

        chatLog.appendChild(actionsContainer);
        chatLog.scrollTop = chatLog.scrollHeight;
    }
    
    // Mostrar sugerencias iniciales al cargar (opcional, o dejar que el bot inicial las renderice)
    if (chatButton) {
        // Ejecutamos una vez cuando abren el chat si está vacío
        chatButton.addEventListener('click', () => {
            if (chatLog.children.length === 1) { // Solo está el mensaje inicial
                appendQuickActions();
            }
        }, { once: true });
    }

    /* --- Logic for Dark Mode Toggle --- */
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
    const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');

    if (themeToggleBtn) {
        // Change the icons inside the button based on previous settings
        if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            themeToggleLightIcon.classList.remove('hidden');
            document.documentElement.classList.add('dark');
        } else {
            themeToggleDarkIcon.classList.remove('hidden');
            document.documentElement.classList.remove('dark');
        }

        themeToggleBtn.addEventListener('click', function () {
            // toggle icons inside button
            themeToggleDarkIcon.classList.toggle('hidden');
            themeToggleLightIcon.classList.toggle('hidden');

            // if set via local storage previously
            if (localStorage.getItem('color-theme')) {
                if (localStorage.getItem('color-theme') === 'light') {
                    document.documentElement.classList.add('dark');
                    localStorage.setItem('color-theme', 'dark');
                } else {
                    document.documentElement.classList.remove('dark');
                    localStorage.setItem('color-theme', 'light');
                }
            } else {
                // if NOT set via local storage previously
                if (document.documentElement.classList.contains('dark')) {
                    document.documentElement.classList.remove('dark');
                    localStorage.setItem('color-theme', 'light');
                } else {
                    document.documentElement.classList.add('dark');
                    localStorage.setItem('color-theme', 'dark');
                }
            }
        });
    }

    /* --- Lógica del Recomendador de Planes --- */
    const recommendButton = document.getElementById('recommend-button');
    const usageInput = document.getElementById('usage-input');
    const recommendationOutput = document.getElementById('recommendation-output');

    if (recommendButton) {
        recommendButton.addEventListener('click', async () => {
            const userNeeds = usageInput.value.trim();
            if (userNeeds === '') {
                // Mostrar un mensaje de error o una animación si el campo está vacío
                recommendationOutput.textContent = "Por favor, describe para qué necesitas internet.";
                recommendationOutput.classList.remove('hidden');
                return;
            }

            // Ocultar la salida anterior y mostrar un mensaje de carga
            recommendationOutput.textContent = "Analizando tu consumo...";
            recommendationOutput.classList.remove('hidden');
            recommendationOutput.classList.add('animate-pulse');

            // Configuración del payload para la API de Gemini
            const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
            const userQuery = `Basándote en las siguientes necesidades: "${userNeeds}", ¿qué plan de internet recomiendas?`;

            // PRECIOS ACTUALIZADOS SEGÚN HTML
            // Básico: 10 Mbps - $21.000
            // Premium (Familiar): 15 Mbps - $24.000 ("Plan PREMIUM", "Más Popular")
            // Pro: 20 Mbps - $30.000

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: {
                    parts: [{ text: "Eres un asesor de planes de internet para Conexiones Argentinas. Tu objetivo es recomendar el mejor plan (Básico, Premium o Pro) de nuestra oferta, basado en las necesidades del cliente. Aquí están los detalles de los planes: - Plan Básico (10 Mbps, $21.000/mes): para navegación, redes sociales, videollamadas básicas. - Plan PREMIUM (15 Mbps, $24.000/mes): para streaming HD/4K, gaming online, múltiples dispositivos. Es el más popular. - Plan Pro (20 Mbps, $30.000/mes): para descargas instantáneas, teletrabajo, manejo de archivos grandes. Responde de forma amigable y profesional. Basándote en la descripción de uso del cliente, recomienda un solo plan y explica brevemente por qué es la mejor opción. No inventes otros planes. Sé conciso y directo en la respuesta." }]
                }
            };

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                const recommendation = result.candidates?.[0]?.content?.parts?.[0]?.text;

                recommendationOutput.textContent = recommendation || 'Lo siento, no pude generar una recomendación. Por favor, intenta describir tu uso de otra forma.';
            } catch (error) {
                console.error('Error al llamar a la API de Gemini:', error);
                recommendationOutput.textContent = 'Hubo un error al procesar tu solicitud. Por favor, intenta de nuevo.';
            } finally {
                recommendationOutput.classList.remove('animate-pulse');
            }
        });
    }
});
