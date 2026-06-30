// Carrega a API do Iframe do YouTube de forma assíncrona
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let player;
let isPlaying = false;
let currentVideoId = "";

// Inicializa o Player Oculto do YT
function onYouTubeIframeAPIReady() {
    player = new YT.Player('yt-player', {
        height: '0',
        width: '0',
        videoId: '',
        playerVars: {
            'playsinline': 1,
            'controls': 0,
            'disablekb': 1
        },
        events: {
            'onStateChange': onPlayerStateChange
        }
    });
}

// Controla o ícone de Play/Pause baseado no estado real do YouTube
function onPlayerStateChange(event) {
    const playIcon = document.getElementById('play-icon');
    if (event.data == YT.PlayerState.PLAYING) {
        isPlaying = true;
        playIcon.className = "fas fa-pause";
    } else {
        isPlaying = false;
        playIcon.className = "fas fa-play ml-0.5";
    }
}

// Função para tocar uma música ao clicar
function playTrack(videoId, title, channel, thumb) {
    currentVideoId = videoId;
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;
    document.getElementById('current-thumb').src = thumb;

    player.loadVideoById(videoId);
    player.playVideo();
}

// Botão de Play/Pause inferior
document.getElementById('play-btn').addEventListener('click', () => {
    if (!currentVideoId) return;
    if (isPlaying) {
        player.pauseVideo();
    } else {
        player.playVideo();
    }
});

// Mock/Simulação de Busca (Substitua por uma API real do YT se quiser busca global)
document.getElementById('search-btn').addEventListener('click', () => {
    const query = document.getElementById('search-input').value;
    if (!query) return;

    const resultsContainer = document.getElementById('results-container');
    document.getElementById('list-title').innerText = `Resultados para "${query}"`;

    // Lista de exemplo (Você pode alimentar isso buscando de uma API ou usando links diretos)
    // Dica: Se colar o ID de um vídeo real do YT aqui, ele vai tocar!
    const mockResults = [
        { id: "dQw4w9WgXcQ", title: `${query} - Mix Especial`, channel: "YouTube Music", thumb: "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg" },
        { id: "9bZkp7q19f0", title: `${query} - LoFi Chill`, channel: "Lofi Girl", thumb: "https://img.youtube.com/vi/9bZkp7q19f0/mqdefault.jpg" }
    ];

    resultsContainer.innerHTML = "";
    mockResults.forEach(track => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between bg-[#1e1e1e] p-3 rounded-lg cursor-pointer hover:bg-[#282828] transition";
        div.onclick = () => playTrack(track.id, track.title, track.channel, track.thumb);

        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${track.thumb}" class="w-12 h-12 rounded object-cover">
                <div>
                    <h4 class="text-sm font-medium truncate w-52">${track.title}</h4>
                    <p class="text-xs text-gray-400">${track.channel}</p>
                </div>
            </div>
            <i class="fas fa-play text-gray-400 pr-2"></i>
        `;
        resultsContainer.appendChild(div);
    });
});