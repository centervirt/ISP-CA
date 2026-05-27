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
        chatLog.scrollTop = chatLog.scrollHeight;

        // Configuración del payload para la API de Gemini
        // NOTA: La API Key debe configurarse aquí o idealmente usarse a través de un backend para no exponerla.
        const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
        const payload = {
            contents: [{ parts: [{ text: userMessage }] }],
            systemInstruction: {
                parts: [{ text: "Actúa como un agente de soporte al cliente de una empresa de internet llamada Conexiones Argentinas. Sé amigable, servicial y conciso. Proporciona información sobre los planes, la cobertura de fibra óptica y resuelve dudas técnicas básicas. Siempre mantén una actitud positiva y profesional. Evita información que no esté relacionada con la empresa. Si no puedes responder, sugiere contactar a un agente humano en el correo info@conexionesargentinas.com.ar o en el número (11) 1234-5678." }]
            }
        };

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const botResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

            botMessageDiv.textContent = botResponse || 'Lo siento, no pude encontrar una respuesta. Por favor, intenta de nuevo o contacta a un agente.';
        } catch (error) {
            console.error('Error al llamar a la API de Gemini:', error);
            botMessageDiv.textContent = 'Hubo un error al procesar tu solicitud. Por favor, intenta de nuevo.';
        } finally {
            chatLog.scrollTop = chatLog.scrollHeight;
        }
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
