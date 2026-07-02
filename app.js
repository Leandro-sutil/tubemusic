let db;
let MINHA_PLAYLIST = [];
let CACHE_PLAYLISTS = []; // Armazena a estrutura de playlists criadas
let currentTrackIndex = -1;
let audioPlayer = new Audio();
let isPlaying = false;
let progressInterval;
let isUserDragging = false; // Trava o timer automático para não atrapalhar o arrastar da barra
let currentView = 'tracks'; // 'tracks' ou 'playlists'
let isShuffle = false; // Controla se o modo aleatório está ativo

// 1. Inicializa o Banco de Dados IndexedDB (Versão 2)
const request = indexedDB.open('TubeMusicDB', 2);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('musicas')) {
        db.createObjectStore('musicas', { keyPath: 'id', autoIncrement: true });
    }
    // Nova Object Store para armazenar coleções de playlists
    if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists', { keyPath: 'id', autoIncrement: true });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    carregarPlaylist();
    carregarPlaylistsDB();
};

request.onerror = (e) => console.error("Erro ao abrir IndexedDB", e);

// Caso o navegador bloqueie por causa da mudança de versão, força a recarga
request.onblocked = () => {
    alert("Por favor, feche as outras abas deste app ou atualize a página para concluir a atualização do banco de dados.");
};

function carregarPlaylist() {
    if (!db) return;
    const transaction = db.transaction(['musicas'], 'readonly');
    const store = transaction.objectStore('musicas');
    const getAll = store.getAll();

    getAll.onsuccess = () => {
        MINHA_PLAYLIST = getAll.result;
        if (currentView === 'tracks') renderPlaylist();
    };
}

// Carrega as tabelas de Playlists do IndexedDB
function carregarPlaylistsDB() {
    if (!db) return;
    const transaction = db.transaction(['playlists'], 'readonly');
    const store = transaction.objectStore('playlists');
    const getAll = store.getAll();

    getAll.onsuccess = () => {
        CACHE_PLAYLISTS = getAll.result;
        if (currentView === 'playlists') renderPlaylistsView();
    };
}

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
        const isCurrent = index === currentTrackIndex && currentView === 'tracks';
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl transition shadow-sm ${isCurrent ? 'bg-[#1db954]/20 border border-[#1db954]' : 'bg-[#141414] border border-[#1f1f1f]'}`;
        
        let artista = "Desconhecido";
        let titulo = track.name.replace('.opus', '').replace('.ogg', '').replace('.mp3', '');
        if (titulo.includes(' - ')) {
            const partes = titulo.split(' - ');
            artista = partes[0];
            titulo = partes.slice(1).join(' - ');
        }

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" id="track-click-${index}">
                <div class="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-gray-400 border border-white/5">
                    <i class="fas ${isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music'}"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-medium ${isCurrent ? 'text-[#1db954]' : 'text-gray-200'} truncate pr-2">${titulo}</h4>
                    <p class="text-xs text-gray-400 truncate mt-0.5">${artista}</p>
                </div>
            </div>
            <div class="flex items-center">
                <button id="add-to-p-${index}" class="text-gray-400 hover:text-white p-2" title="Adicionar à Playlist">
                    <i class="fas fa-plus-circle"></i>
                </button>
                <button id="del-track-${track.id}" class="text-gray-500 hover:text-red-500 p-2 ml-1">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        container.appendChild(div);

        document.getElementById(`track-click-${index}`).onclick = () => { currentView = 'tracks'; playTrack(index); };
        document.getElementById(`add-to-p-${index}`).onclick = (e) => { e.stopPropagation(); promptAdicionarMusicaPlaylist(track); };
        document.getElementById(`del-track-${track.id}`).onclick = (e) => deleteTrack(track.id, e);
    });
}

// Mecanismo de Controle de Áudio Local
function playTrack(index) {
    let listaAlvo = currentView === 'tracks' ? MINHA_PLAYLIST : playlistAtivaTracks;
    if (index < 0 || index >= listaAlvo.length) return;
    
    currentTrackIndex = index;
    const track = listaAlvo[index];

    let artista = "Desconhecido";
    let titulo = track.name.replace('.opus', '').replace('.ogg', '').replace('.mp3', '');
    if (titulo.includes(' - ')) {
        const partes = titulo.split(' - ');
        artista = partes[0];
        titulo = partes.slice(1).join(' - ');
    }

    document.getElementById('current-title').innerText = titulo;
    document.getElementById('current-channel').innerText = artista;

    if (audioPlayer.src) { URL.revokeObjectURL(audioPlayer.src); } 
    audioPlayer.src = URL.createObjectURL(track.file);
    
    // Captura os metadados para saber a duração exata da música assim que carregar
    audioPlayer.onloadedmetadata = () => {
        document.getElementById('total-duration').innerText = formatTime(audioPlayer.duration);
    };

    audioPlayer.play()
        .then(() => {
            isPlaying = true;
            document.getElementById('play-icon').className = "fas fa-pause text-lg";
            document.getElementById('current-icon').className = "fas fa-compact-disc fa-spin text-[#1db954] text-lg";
            startProgress();
            if (currentView === 'tracks') renderPlaylist();
            else if (currentView === 'inside_playlist') renderTracksOfPlaylist();
        })
        .catch(err => {
            console.log("Interação prévia necessária do usuário para disparar o áudio:", err);
        });
}

audioPlayer.onended = () => { nextTrack(); };

// Formata segundos em string amigável de minutos (Ex: 3:45)
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function startProgress() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (audioPlayer.duration && !isUserDragging) {
            const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            document.getElementById('progress-bar').value = percentage;
            // Atualiza dinamicamente o contador visual de minutos atuais
            document.getElementById('current-time').innerText = formatTime(audioPlayer.currentTime);
        }
    }, 500);
}

// Lógica da Barra de Progresso clicável/arrastável (Seek)
const progressBar = document.getElementById('progress-bar');
progressBar.addEventListener('input', () => { isUserDragging = true; });
progressBar.addEventListener('change', () => {
    if (audioPlayer.duration) {
        const newTime = (progressBar.value / 100) * audioPlayer.duration;
        audioPlayer.currentTime = newTime;
        document.getElementById('current-time').innerText = formatTime(newTime);
    }
    isUserDragging = false;
});

function nextTrack() {
    let listaAlvo = currentView === 'tracks' ? MINHA_PLAYLIST : playlistAtivaTracks;
    if (listaAlvo.length === 0) return;

    if (isShuffle) {
        if (listaAlvo.length === 1) {
            playTrack(0);
        } else {
            let randomIndex;
            // Evita repetir a música atual se houver mais opções na lista
            do {
                randomIndex = Math.floor(Math.random() * listaAlvo.length);
            } while (randomIndex === currentTrackIndex);
            playTrack(randomIndex);
        }
    } else {
        if (currentTrackIndex < listaAlvo.length - 1) {
            playTrack(currentTrackIndex + 1);
        } else {
            playTrack(0); 
        }
    }
}

function prevTrack() {
    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
}

window.deleteTrack = function(id, event) {
    event.stopPropagation();
    if (!db) return;
    const transaction = db.transaction(['musicas'], 'readwrite');
    const store = transaction.objectStore('musicas');
    store.delete(id);

    transaction.oncomplete = () => {
        if (currentTrackIndex !== -1 && currentView === 'tracks' && MINHA_PLAYLIST[currentTrackIndex].id === id) {
            resetPlayerVisuals();
        }
        carregarPlaylist();
    };
};

function resetPlayerVisuals() {
    audioPlayer.pause();
    isPlaying = false;
    currentTrackIndex = -1;
    document.getElementById('current-title').innerText = "Nenhuma música tocando";
    document.getElementById('current-channel').innerText = "-";
    document.getElementById('play-icon').className = "fas fa-play text-lg ml-0.5";
    document.getElementById('current-icon').className = "fas fa-music text-gray-400 text-lg";
    document.getElementById('progress-bar').value = 0;
    document.getElementById('current-time').innerText = "0:00";
    document.getElementById('total-duration').innerText = "0:00";
}

// GERENCIADOR DE PLAYLISTS NO INDEXEDDB
let playlistAtivaId = null;
let playlistAtivaTracks = [];

function promptAdicionarMusicaPlaylist(track) {
    if (CACHE_PLAYLISTS.length === 0) {
        alert("Crie uma Playlist primeiro acessando a aba 'Playlists' no topo.");
        return;
    }
    const nomes = CACHE_PLAYLISTS.map((p, i) => `[${i}] ${p.nome}`).join('\n');
    const escolha = prompt(`Digite o número da Playlist desejada para incluir esta música:\n\n${nomes}`);
    
    if (escolha !== null && CACHE_PLAYLISTS[escolha]) {
        const targetPlaylist = CACHE_PLAYLISTS[escolha];
        
        if (targetPlaylist.tracks.some(t => t.name === track.name)) {
            alert("Esta música já está nesta playlist!");
            return;
        }

        targetPlaylist.tracks.push(track);
        
        const transaction = db.transaction(['playlists'], 'readwrite');
        const store = transaction.objectStore('playlists');
        store.put(targetPlaylist);

        transaction.oncomplete = () => {
            alert(`Música adicionada à playlist '${targetPlaylist.nome}'!`);
            carregarPlaylistsDB();
        };
    }
}

function renderPlaylistsView() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = "";

    if (CACHE_PLAYLISTS.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 text-sm">
                Nenhuma playlist criada.<br>Use o botão "Criar Playlist" acima para organizar suas pastas.
            </div>`;
        return;
    }

    CACHE_PLAYLISTS.forEach(playlist => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-[#141414] border border-[#1f1f1f] rounded-xl cursor-pointer hover:bg-[#1c1c1c] transition";
        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1" id="open-p-${playlist.id}">
                <div class="w-12 h-12 rounded-lg bg-[#1db954]/10 text-[#1db954] flex items-center justify-center text-lg border border-[#1db954]/20">
                    <i class="fas fa-folder"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-medium text-gray-200 truncate">${playlist.nome}</h4>
                    <p class="text-xs text-gray-400 mt-0.5">${playlist.tracks.length} música(s)</p>
                </div>
            </div>
            <button id="del-p-${playlist.id}" class="text-gray-500 hover:text-red-400 p-2 ml-2"><i class="fas fa-trash"></i></button>
        `;
        container.appendChild(div);

        document.getElementById(`open-p-${playlist.id}`).onclick = () => abrirPlaylist(playlist);
        document.getElementById(`del-p-${playlist.id}`).onclick = (e) => { e.stopPropagation(); deletarPlaylistAbsoluto(playlist.id); };
    });
}

function abrirPlaylist(playlist) {
    playlistAtivaId = playlist.id;
    playlistAtivaTracks = playlist.tracks;
    currentView = 'inside_playlist';
    document.getElementById('header-title').innerText = playlist.nome;
    renderTracksOfPlaylist();
}

function renderTracksOfPlaylist() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = `
        <button onclick="switchTab('playlists')" class="text-xs text-zinc-400 hover:text-white mb-2 block">
            <i class="fas fa-arrow-left mr-1"></i> Voltar para Playlists
        </button>
    `;

    if (playlistAtivaTracks.length === 0) {
        container.innerHTML += `<p class="text-zinc-500 text-sm text-center py-8">Esta playlist está vazia.</p>`;
        return;
    }

    playlistAtivaTracks.forEach((track, index) => {
        const isCurrent = index === currentTrackIndex && currentView === 'inside_playlist';
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl transition ${isCurrent ? 'bg-[#1db954]/20 border border-[#1db954]' : 'bg-[#141414] border border-[#1f1f1f]'}`;
        
        let artista = "Desconhecido";
        let titulo = track.name.replace('.opus', '').replace('.ogg', '').replace('.mp3', '');
        if (titulo.includes(' - ')) {
            const partes = titulo.split(' - ');
            artista = partes[0];
            titulo = partes.slice(1).join(' - ');
        }

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" id="p-track-${index}">
                <div class="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-gray-400 text-xs">
                    <i class="fas ${isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music'}"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-medium ${isCurrent ? 'text-[#1db954]' : 'text-gray-200'} truncate">${titulo}</h4>
                    <p class="text-xs text-gray-400 truncate">${artista}</p>
                </div>
            </div>
            <button id="p-remove-${index}" class="text-gray-500 hover:text-red-400 p-2 ml-2"><i class="fas fa-minus-circle"></i></button>
        `;
        container.appendChild(div);

        document.getElementById(`p-track-${index}`).onclick = () => { currentView = 'inside_playlist'; playTrack(index); };
        document.getElementById(`p-remove-${index}`).onclick = (e) => { e.stopPropagation(); removerMusicaDaPlaylist(index); };
    });
}

function removerMusicaDaPlaylist(index) {
    playlistAtivaTracks.splice(index, 1);
    const transaction = db.transaction(['playlists'], 'readwrite');
    const store = transaction.objectStore('playlists');
    
    const pObj = CACHE_PLAYLISTS.find(p => p.id === playlistAtivaId);
    pObj.tracks = playlistAtivaTracks;
    
    store.put(pObj);
    transaction.oncomplete = () => {
        if (currentView === 'inside_playlist' && currentTrackIndex === index) resetPlayerVisuals();
        carregarPlaylistsDB();
    };
}

function deletarPlaylistAbsoluto(id) {
    if (confirm("Deseja mesmo excluir esta playlist? As músicas continuarão guardadas na sua biblioteca principal.")) {
        const transaction = db.transaction(['playlists'], 'readwrite');
        const store = transaction.objectStore('playlists');
        store.delete(id);
        transaction.oncomplete = () => carregarPlaylistsDB();
    }
}

// GERENCIADOR DE ABAS DA INTERFACE
window.switchTab = function(tab) {
    currentView = tab;
    const tabTracks = document.getElementById('tab-tracks');
    const tabPlaylists = document.getElementById('tab-playlists');
    const createBtn = document.getElementById('create-playlist-btn');
    const addMusicBtn = document.getElementById('toggle-add-btn');

    if (tab === 'tracks') {
        tabTracks.className = "text-[#1db954] border-b-2 border-[#1db954] pb-1 px-1";
        tabPlaylists.className = "text-gray-400 pb-1 px-1 hover:text-white";
        document.getElementById('header-title').innerText = "Minha Biblioteca";
        createBtn.classList.add('hidden');
        addMusicBtn.classList.remove('hidden');
        renderPlaylist();
    } else {
        tabPlaylists.className = "text-[#1db954] border-b-2 border-[#1db954] pb-1 px-1";
        tabTracks.className = "text-gray-400 pb-1 px-1 hover:text-white";
        document.getElementById('header-title').innerText = "Minhas Playlists";
        createBtn.classList.remove('hidden');
        addMusicBtn.classList.add('hidden');
        document.getElementById('add-music-form').classList.add('hidden');
        renderPlaylistsView();
    }
};

document.getElementById('tab-tracks').addEventListener('click', () => switchTab('tracks'));
document.getElementById('tab-playlists').addEventListener('click', () => switchTab('playlists'));

document.getElementById('create-playlist-btn').addEventListener('click', () => {
    const nome = prompt("Nome da Nova Playlist:");
    if (nome && nome.trim() !== "") {
        if (!db) return;
        const transaction = db.transaction(['playlists'], 'readwrite');
        const store = transaction.objectStore('playlists');
        store.add({ nome: nome.trim(), tracks: [] });
        transaction.oncomplete = () => carregarPlaylistsDB();
    }
});

// INTERAÇÃO DE ARQUIVOS UPSTREAM
document.getElementById('toggle-add-btn').addEventListener('click', () => {
    document.getElementById('add-music-form').classList.toggle('hidden');
});

document.getElementById('audio-files').addEventListener('change', (e) => {
    const count = e.target.files.length;
    document.getElementById('selected-files-count').innerText = `${count} arquivo(s) selecionado(s)`;
});

// PROCESSAMENTO ASSÍNCRONO EM LOTE (BATCHING)
document.getElementById('save-track-btn').addEventListener('click', async () => {
    const input = document.getElementById('audio-files');
    const saveBtn = document.getElementById('save-track-btn');
    const statusText = document.getElementById('selected-files-count');
    
    if (input.files.length === 0) {
        alert("Por favor, selecione ao menos um arquivo de música do aparelho.");
        return;
    }

    if (!db) {
        alert("O banco de dados ainda está inicializando. Por favor, aguarde um segundo e tente novamente.");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.className = "w-full bg-gray-600 text-gray-300 font-bold text-sm py-2 rounded-lg cursor-not-allowed mt-2";
    
    const totalArquivos = input.files.length;
    
    const salvarArquivoNoDB = (file) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['musicas'], 'readwrite');
            const store = transaction.objectStore('musicas');
            
            const request = store.add({ name: file.name, file: file });
            
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    };

    try {
        for (let i = 0; i < totalArquivos; i++) {
            const file = input.files[i];
            statusText.innerText = `Salvando: ${i + 1} de ${totalArquivos} músicas...`;
            await salvarArquivoNoDB(file);
        }

        alert(`${totalArquivos} músicas importadas com sucesso para a biblioteca local!`);
        
        input.value = "";
        statusText.innerText = "Nenhum arquivo selecionado";
        document.getElementById('add-music-form').classList.add('hidden');
        carregarPlaylist();

    } catch (error) {
        console.error("Erro durante a importação em lote:", error);
        alert("Ocorreu um erro ao salvar algumas músicas. Verifique se há espaço disponível.");
    } finally {
        saveBtn.disabled = false;
        saveBtn.className = "w-full bg-white text-black font-bold text-sm py-2 rounded-lg transition active:scale-95 mt-2";
    }
});

// Botões de mídia do rodapé
document.getElementById('next-btn').addEventListener('click', nextTrack);
document.getElementById('prev-btn').addEventListener('click', prevTrack);

// Alternador do modo aleatório (Shuffle)
document.getElementById('shuffle-btn').addEventListener('click', () => {
    isShuffle = !isShuffle;
    const shuffleBtn = document.getElementById('shuffle-btn');
    if (isShuffle) {
        shuffleBtn.className = "text-[#1db954] text-sm transition-colors"; // Ativo (Verde)
    } else {
        shuffleBtn.className = "text-gray-500 text-sm transition-colors"; // Inativo (Cinza)
    }
});

document.getElementById('play-btn').addEventListener('click', () => {
    let listaAlvo = currentView === 'tracks' ? MINHA_PLAYLIST : playlistAtivaTracks;
    if (currentTrackIndex === -1 && listaAlvo.length > 0) { playTrack(0); return; }
    if (currentTrackIndex === -1) return;
    
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
