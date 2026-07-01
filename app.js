let db;
let MINHA_PLAYLIST = [];
let currentTrackIndex = -1;
let audioPlayer = new Audio();
let isPlaying = false;
let progressInterval;

// 1. Inicializa o Banco de Dados IndexedDB
const request = indexedDB.open('TubeMusicDB', 1);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('musicas')) {
        // Cria uma tabela que gera IDs automáticos para cada faixa salva
        db.createObjectStore('musicas', { keyPath: 'id', autoIncrement: true });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    carregarPlaylist();
};

request.onerror = (e) => console.error("Erro ao abrir IndexedDB", e);

// 2. Carrega as músicas do banco para a memória do app
function carregarPlaylist() {
    const transaction = db.transaction(['musicas'], 'readonly');
    const store = transaction.objectStore('musicas');
    const getAll = store.getAll();

    getAll.onsuccess = () => {
        MINHA_PLAYLIST = getAll.result;
        renderPlaylist();
    };
}

// 3. Renderiza a playlist na tela com suporte offline
function renderPlaylist() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = "";

    if (MINHA_PLAYLIST.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 text-sm">
                Sua biblioteca está vazia.<br>
                Clique em "+ Nova Música" para importar arquivos .opus ou .mp3 do celular.
            </div>`;
        return;
    }

    MINHA_PLAYLIST.forEach((track, index) => {
        const isCurrent = index === currentTrackIndex;
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl transition shadow-sm ${isCurrent ? 'bg-[#1db954]/20 border border-[#1db954]' : 'bg-[#141414] border border-[#1f1f1f]'}`;
        
        // Tenta separar o nome do Artista e do Título se o arquivo estiver formatado como "Artista - Titulo.opus"
        let artista = "Desconhecido";
        let titulo = track.name.replace('.opus', '').replace('.ogg', '').replace('.mp3', '');
        if (titulo.includes(' - ')) {
            const partes = titulo.split(' - ');
            artista = partes[0];
            titulo = partes.slice(1).join(' - ');
        }

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onclick="playTrack(${index})">
                <div class="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-gray-400 border border-white/5">
                    <i class="fas ${isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music'}"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-medium ${isCurrent ? 'text-[#1db954]' : 'text-gray-200'} truncate pr-2">${titulo}</h4>
                    <p class="text-xs text-gray-400 truncate mt-0.5">${artista}</p>
                </div>
            </div>
            <button onclick="deleteTrack(${track.id}, event)" class="text-gray-500 hover:text-red-500 p-2 ml-2">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        container.appendChild(div);
    });
}

// 4. Mecanismo de Controle de Áudio Local
function playTrack(index) {
    if (index < 0 || index >= MINHA_PLAYLIST.length) return;
    
    currentTrackIndex = index;
    const track = MINHA_PLAYLIST[index];

    let artista = "Desconhecido";
    let titulo = track.name.replace('.opus', '').replace('.ogg', '').replace('.mp3', '');
    if (titulo.includes(' - ')) {
        const partes = titulo.split(' - ');
        artista = partes[0];
        titulo = partes.slice(1).join(' - ');
    }

    document.getElementById('current-title').innerText = titulo;
    document.getElementById('current-channel').innerText = artista;

    // Converte o arquivo blob em uma URL local executável
    if (audioPlayer.src) { URL.revokeObjectURL(audioPlayer.src); } // Limpa cache da música anterior
    audioPlayer.src = URL.createObjectURL(track.file);
    
    audioPlayer.play()
        .then(() => {
            isPlaying = true;
            document.getElementById('play-icon').className = "fas fa-pause text-lg";
            document.getElementById('current-icon').className = "fas fa-compact-disc fa-spin text-[#1db954] text-lg";
            startProgress();
            renderPlaylist();
        })
        .catch(err => {
            console.log("Interação prévia necessária do usuário para disparar o áudio:", err);
        });
}

// Passa para a próxima música automaticamente quando a atual termina
audioPlayer.onended = () => { nextTrack(); };

function startProgress() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (audioPlayer.duration) {
            const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            document.getElementById('progress-bar').style.width = `${percentage}%`;
        }
    }, 500);
}

function nextTrack() {
    if (MINHA_PLAYLIST.length === 0) return;
    if (currentTrackIndex < MINHA_PLAYLIST.length - 1) {
        playTrack(currentTrackIndex + 1);
    } else {
        playTrack(0); // Volta pro começo se acabar a playlist
    }
}

function prevTrack() {
    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
}

// Deleta do Banco de Dados local do navegador
window.deleteTrack = function(id, event) {
    event.stopPropagation();
    const transaction = db.transaction(['musicas'], 'readwrite');
    const store = transaction.objectStore('musicas');
    store.delete(id);

    transaction.oncomplete = () => {
        if (currentTrackIndex !== -1 && MINHA_PLAYLIST[currentTrackIndex].id === id) {
            audioPlayer.pause();
            isPlaying = false;
            currentTrackIndex = -1;
            document.getElementById('current-title').innerText = "Nenhuma música tocando";
            document.getElementById('current-channel').innerText = "-";
            document.getElementById('play-icon').className = "fas fa-play text-lg ml-0.5";
            document.getElementById('current-icon').className = "fas fa-music text-gray-400 text-lg";
            document.getElementById('progress-bar').style.width = `0%`;
        }
        carregarPlaylist();
    };
};

// 5. Interações da Interface e upload de arquivos
document.getElementById('toggle-add-btn').addEventListener('click', () => {
    document.getElementById('add-music-form').classList.toggle('hidden');
});

document.getElementById('audio-files').addEventListener('change', (e) => {
    const count = e.target.files.length;
    document.getElementById('selected-files-count').innerText = `${count} arquivo(s) selecionado(s)`;
});

document.getElementById('save-track-btn').addEventListener('click', () => {
    const input = document.getElementById('audio-files');
    if (input.files.length === 0) {
        alert("Por favor, selecione ao menos um arquivo de música do aparelho.");
        return;
    }

    const transaction = db.transaction(['musicas'], 'readwrite');
    const store = transaction.objectStore('musicas');

    // Itera e adiciona arquivo por arquivo dentro do IndexedDB
    for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        store.add({ name: file.name, file: file });
    }

    transaction.oncomplete = () => {
        input.value = "";
        document.getElementById('selected-files-count').innerText = "Nenhum arquivo selecionado";
        document.getElementById('add-music-form').classList.add('hidden');
        carregarPlaylist(); // Atualiza a lista na interface
    };
});

// Botões de mídia do rodapé
document.getElementById('next-btn').addEventListener('click', nextTrack);
document.getElementById('prev-btn').addEventListener('click', prevTrack);
document.getElementById('play-btn').addEventListener('click', () => {
    if (currentTrackIndex === -1 && MINHA_PLAYLIST.length > 0) { playTrack(0); return; }
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
        document.getElementById('play-icon').className = "fas fa-play text-lg ml-0.5";
        document.getElementById('current-icon').className = "fas fa-music text-gray-400 text-lg";
    } else {
        audioPlayer.play();
        isPlaying = true;
        document.getElementById('play-icon').className = "fas fa-pause text-lg";
        document.getElementById('current-icon').className = "fas fa-compact-disc fa-spin text-[#1db954] text-lg";
    }
});
