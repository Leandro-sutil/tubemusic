// 1. Carrega a API do Iframe do YouTube
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let player;
let isPlaying = false;
let currentVideoId = "";
let progressInterval;

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

// 2. FUNÇÃO DE BUSCA VIA MÓDULO PÚBLICO (Sem chaves ou proxies)
async function searchYouTube(query) {
    const container = document.getElementById('results-container');
    container.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mr-2"></i> Buscando músicas...</div>`;

    // Se o usuário colocou um link direto
    if (query.includes('youtube.com/watch?v=') || query.includes('youtu.be/')) {
        let videoId = query.split('v=')[1] || query.split('/').pop();
        if(videoId.includes('&')) videoId = videoId.split('&')[0];
        
        playTrack(videoId, "Vídeo via Link Direto", "YouTube", `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
        container.innerHTML = `<div class="text-center py-12 text-[#1db954]"><i class="fas fa-check-circle text-2xl mb-2 block"></i> Tocando link direto!</div>`;
        return;
    }

    try {
        // Importa dinamicamente a biblioteca de busca anônima direto pelo navegador
        const ytSearch = await import('https://cdn.jsdelivr.net/npm/youtube-search-without-api-key@2.0.7/+esm');
        
        // Faz a pesquisa direto nos servidores do YouTube mascarando o cabeçalho como busca nativa
        const results = await ytSearch.default(query);

        if (!results || results.length === 0) {
            container.innerHTML = `<div class="text-center py-12 text-gray-500">Nenhuma música encontrada. Tente reescrever.</div>`;
            return;
        }

        container.innerHTML = ""; // Limpa a tela
        
        // Exibe os primeiros 15 resultados encontrados
        results.slice(0, 15).forEach(video => {
            const videoId = video.id?.videoId || video.id;
            if (!videoId) return;

            const title = video.title || "Música sem título";
            const author = video.snippet?.channelTitle || "YouTube Video";
            const thumbUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

            const div = document.createElement('div');
            div.className = "flex items-center justify-between bg-[#141414] border border-[#1f1f1f] p-3 rounded-xl cursor-pointer hover:bg-[#1c1c1c] active:scale-[0.98] transition shadow-sm";
            div.onclick = () => playTrack(videoId, title, author, thumbUrl);
            
            div.innerHTML = `
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <img src="${thumbUrl}" class="w-14 h-14 rounded-lg object-cover bg-zinc-800">
                    <div class="min-w-0 flex-1">
                        <h4 class="text-sm font-medium text-gray-200 truncate pr-2">${title}</h4>
                        <p class="text-xs text-gray-400 truncate mt-0.5">${author}</p>
                    </div>
                </div>
                <div class="bg-white/5 w-8 h-8 rounded-full flex items-center justify-center ml-2 flex-shrink-0">
                    <i class="fas fa-play text-xs text-gray-300"></i>
                </div>
            `;
            container.appendChild(div);
        });

    } catch (error) {
        console.error(error);
        container.innerHTML = `<div class="text-center py-12 text-red-400">Ocorreu um erro ao carregar os resultados. Tente novamente em instantes.</div>`;
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
