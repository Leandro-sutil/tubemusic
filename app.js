var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let player;
let isPlaying = false;
let currentTrackIndex = -1;
let progressInterval;

// 💾 BANCO DE DADOS LOCAL: Busca as músicas gravadas no celular ou inicia vazio
let MINHA_PLAYLIST = JSON.parse(localStorage.getItem('tubemusic_playlist')) || [];

function onYouTubeIframeAPIReady() {
    player = new YT.Player('yt-player', {
        height: '0',
        width: '0',
        videoId: '',
        playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1 },
        events: { 'onStateChange': onPlayerStateChange }
    });
    renderPlaylist();
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
    if (event.data == YT.PlayerState.ENDED) { nextTrack(); }
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

function getYouTubeId(url) {
    let videoId = "";
    if (url.includes('youtube.com/watch?v=')) {
        videoId = url.split('v=')[1].split('&')[0];
    } else if (url.includes('youtu.be/')) {
        videoId = url.split('/').pop().split('?')[0];
    }
    return videoId;
}

function playTrack(index) {
    if (index < 0 || index >= MINHA_PLAYLIST.length) return;
    
    currentTrackIndex = index;
    const track = MINHA_PLAYLIST[index];
    const videoId = getYouTubeId(track.url);
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    document.getElementById('current-title').innerText = track.title;
    document.getElementById('current-channel').innerText = track.author;
    document.getElementById('current-thumb').src = thumbUrl;

    player.loadVideoById(videoId);
    player.playVideo();
    renderPlaylist();
}

function nextTrack() {
    if (MINHA_PLAYLIST.length === 0) return;
    if (currentTrackIndex < MINHA_PLAYLIST.length - 1) {
        playTrack(currentTrackIndex + 1);
    } else {
        playTrack(0);
    }
}

function prevTrack() {
    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
}

// Renderiza a lista na tela com botão de Deletar
function renderPlaylist() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = "";

    if (MINHA_PLAYLIST.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-gray-500 text-sm">Sua biblioteca está vazia.<br>Clique em "+ Nova Música" acima para adicionar.</div>`;
        return;
    }

    MINHA_PLAYLIST.forEach((track, index) => {
        const videoId = getYouTubeId(track.url);
        const thumbUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        const isCurrent = index === currentTrackIndex;

        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl transition shadow-sm ${isCurrent ? 'bg-[#1db954]/20 border border-[#1db954]' : 'bg-[#141414] border border-[#1f1f1f]'}`;
        
        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onclick="playTrack(${index})">
                <img src="${thumbUrl}" class="w-14 h-14 rounded-lg object-cover bg-zinc-800">
                <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-medium ${isCurrent ? 'text-[#1db954]' : 'text-gray-200'} truncate pr-2">${track.title}</h4>
                    <p class="text-xs text-gray-400 truncate mt-0.5">${track.author}</p>
                </div>
            </div>
            <button onclick="deleteTrack(${index}, event)" class="text-gray-500 hover:text-red-500 p-2 ml-2">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        container.appendChild(div);
    });
}

// Função para deletar uma música da memória do celular
window.deleteTrack = function(index, event) {
    event.stopPropagation(); // Evita dar play na música ao clicar em deletar
    MINHA_PLAYLIST.splice(index, 1);
    localStorage.setItem('tubemusic_playlist', JSON.stringify(MINHA_PLAYLIST));
    if (index === currentTrackIndex) {
        player.stopVideo();
        currentTrackIndex = -1;
        document.getElementById('current-title').innerText = "Nenhuma música tocando";
    }
    renderPlaylist();
};

// Interface: Mostrar/Esconder o formulário de cadastro
document.getElementById('toggle-add-btn').addEventListener('click', () => {
    const form = document.getElementById('add-music-form');
    form.classList.toggle('hidden');
});

// AÇÃO DE SALVAR A MÚSICA NO BANCO LOCAL
document.getElementById('save-track-btn').addEventListener('click', () => {
    const title = document.getElementById('track-title').value.trim();
    const author = document.getElementById('track-author').value.trim();
    const url = document.getElementById('track-url').value.trim();

    if (!title || !url) {
        alert("Por favor, preencha pelo menos o Título e o Link do YouTube.");
        return;
    }

    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
        alert("Link do YouTube inválido.");
        return;
    }

    // Adiciona o objeto na lista
    MINHA_PLAYLIST.push({ title, author: author || "YouTube", url });
    
    // Grava no "Banco de Dados" do celular
    localStorage.setItem('tubemusic_playlist', JSON.stringify(MINHA_PLAYLIST));

    // Limpa os campos do formulário e esconde ele
    document.getElementById('track-title').value = "";
    document.getElementById('track-author').value = "";
    document.getElementById('track-url').value = "";
    document.getElementById('add-music-form').classList.add('hidden');

    renderPlaylist();
});

document.getElementById('next-btn').addEventListener('click', nextTrack);
document.getElementById('prev-btn').addEventListener('click', prevTrack);
document.getElementById('play-btn').addEventListener('click', () => {
    if (currentTrackIndex === -1 && MINHA_PLAYLIST.length > 0) { playTrack(0); return; }
    if (isPlaying) { player.pauseVideo(); } else { player.playVideo(); }
});
