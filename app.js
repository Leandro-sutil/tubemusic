var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let player;
let isPlaying = false;
let currentVideoId = "";
let progressInterval;

// Lista de instâncias públicas do Invidious (Se uma falhar, o app tenta a outra)
const INVIDIOUS_INSTANCES = [
    "https://invidious.perennialte.ch",
    "https://inv.tux.digital",
    "https://yewtu.be",
    "https://vid.puffyan.us",
    "https://invidious.nerdvpn.de"
];

function onYouTubeIframeAPIReady() {
    player = new YT.Player('yt-player', {
        height: '0',
        width: '0',
        videoId: '',
        playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1 },
        events: { 'onStateChange': onPlayerStateChange }
    });
}

function onPlayerStateChange(event) {
    const playIcon = document.getElementById('play-icon');
    if (event.data == YT.PlayerState.PLAYING) {
        isPlaying = true;
        playIcon.className = "fas fa-pause text-lg";
        startProgress();
    } else {
        isPlaying = false;
        playIcon.className = "fas fa-play text-lg ml-0.5";
        clearInterval(progressInterval);
    }
}

function startProgress() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (player && player.getCurrentTime) {
            const currentTime = player.getCurrentTime();
            const duration = player.getDuration();
            if (duration > 0) {
                const percentage = (currentTime / duration) * 100;
                document.getElementById('progress-bar').style.width = `${percentage}%`;
            }
        }
    }, 1000);
}

function playTrack(videoId, title, channel, thumb) {
    currentVideoId = videoId;
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;
    document.getElementById('current-thumb').src = thumb;

    player.loadVideoById(videoId);
    player.playVideo();
}

document.getElementById('play-btn').addEventListener('click', () => {
    if (!currentVideoId) return;
    if (isPlaying) { player.pauseVideo(); } else { player.playVideo(); }
});

// FUNÇÃO DE BUSCA ROBUSTA (Tenta vários servidores se um der erro)
async function searchYouTube(query) {
    const container = document.getElementById('results-container');
    container.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mr-2"></i> Buscando no YouTube...</div>`;

    // Se for link direto do YouTube, ignora a busca e toca direto (Evita erros)
    if (query.includes('youtube.com/watch?v=') || query.includes('youtu.be/')) {
        let videoId = query.split('v=')[1] || query.split('/').pop();
        if(videoId.includes('&')) videoId = videoId.split('&')[0];
        
        playTrack(videoId, "Vídeo via Link Direto", "YouTube", `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
        container.innerHTML = `<div class="text-center py-12 text-[#1db954]"><i class="fas fa-check-circle text-2xl mb-2 block"></i> Tocando link direto!</div>`;
        return;
    }

    let success = false;

    // Loop que testa os servidores até um funcionar
    for (const baseUrl of INVIDIOUS_INSTANCES) {
        try {
            console.log(`Tentando buscar em: ${baseUrl}`);
            const response = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
                signal: AbortSignal.timeout(5000) // Desiste se o servidor demorar mais de 5 segundos
            });
            
            if (!response.ok) throw new Error("Erro na resposta do servidor");

            const data = await response.json();

            if (!data || data.length === 0) {
                container.innerHTML = `<div class="text-center py-12 text-gray-500">Nenhum resultado encontrado.</div>`;
                success = true;
                break;
            }

            container.innerHTML = ""; // Limpa a tela de carregando
            
            data.forEach(video => {
                const div = document.createElement('div');
                div.className = "flex items-center justify-between bg-[#141414] border border-[#1f1f1f] p-3 rounded-xl cursor-pointer hover:bg-[#1c1c1c] active:scale-[0.98] transition shadow-sm";
                
                const thumbUrl = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
                div.onclick = () => playTrack(video.videoId, video.title, video.author, thumbUrl);
                
                div.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <img src="${thumbUrl}" class="w-14 h-14 rounded-lg object-cover bg-zinc-800">
                        <div class="min-w-0 flex-1">
                            <h4 class="text-sm font-medium text-gray-200 truncate pr-2">${video.title}</h4>
                            <p class="text-xs text-gray-400 truncate mt-0.5">${video.author}</p>
                        </div>
                    </div>
                    <div class="bg-white/5 w-8 h-8 rounded-full flex items-center justify-center ml-2 flex-shrink-0">
                        <i class="fas fa-play text-xs text-gray-300"></i>
                    </div>
                `;
                container.appendChild(div);
            });

            success = true;
            break; // Sai do loop pois funcionou!

        } catch (error) {
            console.warn(`Instância ${baseUrl} falhou ou expirou o tempo. Tentando a próxima...`);
        }
    }

    // Se rodou todas as opções e nenhuma deu certo
    if (!success) {
        container.innerHTML = `
            <div class="text-center py-12 text-red-400 p-4">
                <i class="fas fa-exclamation-triangle text-3xl mb-2 block text-amber-500"></i>
                <p class="font-semibold">Servidores de busca instáveis no momento.</p>
                <p class="text-xs text-gray-400 mt-2">Dica: Você ainda pode colar o link direto de qualquer vídeo do YouTube na barra acima para escutar!</p>
            </div>
        `;
    }
}

document.getElementById('search-btn').addEventListener('click', () => {
    const query = document.getElementById('search-input').value;
    if (query) searchYouTube(query);
});

document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = document.getElementById('search-input').value;
        if (query) searchYouTube(query);
    }
});
