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
let historyStack = []; // Guarda o histórico real de reprodução (para o botão "anterior" nunca ser aleatório)
let searchQuery = ''; // Termo de busca atual digitado pelo usuário

// --- Persistência de estado (lembrar última música e ponto de reprodução) ---
const STORAGE_KEY = 'tubemusic_ultimo_estado';
let stateRestaurado = false;
let progressTickCount = 0;

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
        MINHA_PLAYLIST = ordenarPorTitulo(getAll.result);
        if (currentView === 'tracks') renderPlaylist();
        tentarRestaurarEstado();
        buscarCapasFaltantes();
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

// Extrai artista/título de uma faixa a partir do nome do arquivo (lógica centralizada)
function parseTrackInfo(track) {
    let artista = "Desconhecido";
    let titulo = track.name.replace('.opus', '').replace('.ogg', '').replace('.mp3', '');
    if (titulo.includes(' - ')) {
        const partes = titulo.split(' - ');
        artista = partes[0];
        titulo = partes.slice(1).join(' - ');
    }
    return { artista, titulo };
}

// Ordena uma lista de faixas em ordem alfabética pelo título (ignorando acentos/maiúsculas)
function ordenarPorTitulo(lista) {
    return [...lista].sort((a, b) => {
        const tituloA = parseTrackInfo(a).titulo;
        const tituloB = parseTrackInfo(b).titulo;
        return tituloA.localeCompare(tituloB, 'pt-BR', { sensitivity: 'base' });
    });
}

// --- CAPAS DE ÁLBUM (identificação automática via API pública do iTunes) ---
// A API do iTunes não exige chave e é gratuita para uso como este.
// Ela funciona melhor quando o arquivo segue o padrão "Artista - Título.mp3".
async function buscarCapaNaAPI(artista, titulo) {
    const tentativas = [];
    if (artista && artista !== 'Desconhecido') tentativas.push(`${artista} ${titulo}`);
    tentativas.push(titulo);

    for (const termo of tentativas) {
        try {
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(termo)}&media=music&entity=song&limit=1`;
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
                // A API devolve uma miniatura pequena (100x100); trocamos para uma versão maior
                return data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
            }
        } catch (e) {
            console.warn('Falha ao consultar a API do iTunes para capa:', e);
        }
    }
    return null;
}

// Baixa os bytes da imagem e converte para base64 (data URL), para guardar a
// capa dentro do IndexedDB e o app conseguir mostrá-la mesmo offline depois.
async function baixarCapaComoDataUrl(artworkUrl) {
    try {
        const resp = await fetch(artworkUrl);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        // Se a CDN de imagens não permitir baixar os bytes (CORS), ainda
        // conseguimos mostrar a capa via URL direta quando estiver online.
        console.warn('Não foi possível baixar os bytes da capa (a exibição online ainda deve funcionar):', e);
        return null;
    }
}

let buscandoCapas = false;
function atualizarBotaoCapas(carregando) {
    const btn = document.getElementById('refresh-covers-btn');
    if (!btn) return;
    btn.querySelector('i').className = carregando ? 'fas fa-spinner fa-spin' : 'fas fa-image';
    btn.disabled = carregando;
}

// Processa, uma de cada vez (com pequena pausa entre elas), as músicas que
// ainda não têm capa identificada. forcar=true também tenta de novo as que
// falharam antes (útil para tentar novamente depois de ficar online).
async function buscarCapasFaltantes(forcar = false) {
    if (buscandoCapas || !db) return;
    buscandoCapas = true;
    atualizarBotaoCapas(true);

    const faltando = MINHA_PLAYLIST.filter(t => forcar ? (!t.capaDataUrl && !t.capaUrlOnline) : !t.capaTentada);

    for (const track of faltando) {
        const { artista, titulo } = parseTrackInfo(track);
        const artworkUrl = await buscarCapaNaAPI(artista, titulo);
        let capaDataUrl = null;
        if (artworkUrl) capaDataUrl = await baixarCapaComoDataUrl(artworkUrl);

        const atualizado = {
            ...track,
            capaTentada: true,
            capaDataUrl: capaDataUrl || (forcar ? track.capaDataUrl : null) || null,
            capaUrlOnline: capaDataUrl ? null : (artworkUrl || track.capaUrlOnline || null)
        };

        await new Promise((resolve) => {
            const transaction = db.transaction(['musicas'], 'readwrite');
            transaction.objectStore('musicas').put(atualizado);
            transaction.oncomplete = resolve;
            transaction.onerror = resolve;
        });

        const idx = MINHA_PLAYLIST.findIndex(t => t.id === track.id);
        if (idx !== -1) MINHA_PLAYLIST[idx] = atualizado;
        if (currentTrackIndex === idx) atualizarCapaRodape(atualizado);
        if (currentView === 'tracks') renderPlaylist();

        await new Promise(r => setTimeout(r, 300)); // evita bater na API rápido demais
    }

    buscandoCapas = false;
    atualizarBotaoCapas(false);
}

// Gera o HTML da miniatura (capa se existir, ou o ícone padrão de nota musical)
function renderCapaHtml(track, tamanhoClasses, iconeClasses) {
    const src = track.capaDataUrl || track.capaUrlOnline;
    if (src) {
        return `<div class="${tamanhoClasses} rounded-lg overflow-hidden border border-white/5 shrink-0"><img src="${src}" class="w-full h-full object-cover" alt="Capa"></div>`;
    }
    return `<div class="${tamanhoClasses} rounded-lg bg-zinc-800 flex items-center justify-center text-gray-400 border border-white/5 shrink-0"><i class="fas ${iconeClasses}"></i></div>`;
}

// Atualiza a miniatura do rodapé (mostra a capa da música atual, ou o ícone padrão)
function atualizarCapaRodape(track) {
    const img = document.getElementById('current-thumb-img');
    const icon = document.getElementById('current-icon');
    if (!img || !icon) return;
    const src = track ? (track.capaDataUrl || track.capaUrlOnline) : null;
    if (src) {
        img.src = src;
        img.classList.remove('hidden');
        icon.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        icon.classList.remove('hidden');
    }
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

    const query = searchQuery.trim().toLowerCase();
    let itensParaExibir = MINHA_PLAYLIST.map((track, index) => ({ track, index }));

    if (query) {
        itensParaExibir = itensParaExibir.filter(({ track }) => {
            const { artista, titulo } = parseTrackInfo(track);
            return titulo.toLowerCase().includes(query) || artista.toLowerCase().includes(query);
        });
    }

    if (itensParaExibir.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 text-sm">
                Nenhuma música encontrada para "${searchQuery}".
            </div>`;
        return;
    }

    itensParaExibir.forEach(({ track, index }) => {
        const isCurrent = index === currentTrackIndex && currentView === 'tracks';
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl transition shadow-sm ${isCurrent ? 'bg-[#1db954]/20 border border-[#1db954]' : 'bg-[#141414] border border-[#1f1f1f]'}`;
        
        const { artista, titulo } = parseTrackInfo(track);

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" id="track-click-${index}">
                ${renderCapaHtml(track, 'w-12 h-12', isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music')}
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
// options.isBack = true indica navegação pelo botão "anterior": nunca aleatória,
// e não deve empilhar mais um item no histórico de reprodução.
function playTrack(index, options = {}) {
    const { isBack = false } = options;
    let listaAlvo = currentView === 'tracks' ? MINHA_PLAYLIST : playlistAtivaTracks;
    if (index < 0 || index >= listaAlvo.length) return;

    if (!isBack && currentTrackIndex !== -1 && currentTrackIndex !== index) {
        historyStack.push(currentTrackIndex);
    }

    currentTrackIndex = index;
    const track = listaAlvo[index];

    const { artista, titulo } = parseTrackInfo(track);

    document.getElementById('current-title').innerText = titulo;
    document.getElementById('current-channel').innerText = artista;
    atualizarCapaRodape(track);

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
            atualizarCapaRodape(track); // reaplica a capa, já que a linha acima reseta as classes do ícone
            startProgress();
            atualizarMediaSession(titulo, artista);
            if (currentView === 'tracks') renderPlaylist();
            else if (currentView === 'inside_playlist') renderTracksOfPlaylist();
        })
        .catch(err => {
            console.log("Interação prévia necessária do usuário para disparar o áudio:", err);
        });

    salvarEstadoAtual();
}

audioPlayer.onended = () => { nextTrack(); };

// Sem isso, o navegador pode encerrar o áudio quando a tela bloqueia ou o
// app vai para segundo plano, o que fazia a reprodução "parar sozinha"
// depois de algumas músicas.
audioPlayer.onerror = () => {
    console.warn("Falha ao carregar/reproduzir a faixa atual, pulando para a próxima.", audioPlayer.error);
    setTimeout(() => { nextTrack(); }, 400);
};

function atualizarMediaSession(titulo, artista) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: titulo,
        artist: artista,
        album: 'TubeMusic Premium'
    });
    navigator.mediaSession.playbackState = 'playing';
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => document.getElementById('play-btn').click());
    navigator.mediaSession.setActionHandler('pause', () => document.getElementById('play-btn').click());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
}

// Formata segundos em string amigável de minutos (Ex: 3:45)
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function startProgress() {
    clearInterval(progressInterval);
    progressTickCount = 0;
    progressInterval = setInterval(() => {
        if (audioPlayer.duration && !isUserDragging) {
            const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            document.getElementById('progress-bar').value = percentage;
            // Atualiza dinamicamente o contador visual de minutos atuais
            document.getElementById('current-time').innerText = formatTime(audioPlayer.currentTime);
        }
        // Salva o progresso a cada ~2 segundos, sem sobrecarregar o localStorage
        progressTickCount++;
        if (progressTickCount % 4 === 0) salvarEstadoAtual();
    }, 500);
}

// Guarda a faixa atual e o ponto exato onde parou, para retomar depois de fechar o app
function salvarEstadoAtual() {
    if (currentTrackIndex === -1) return;
    const listaAlvo = currentView === 'tracks' ? MINHA_PLAYLIST : playlistAtivaTracks;
    const track = listaAlvo[currentTrackIndex];
    if (!track) return;

    const estado = {
        view: currentView,
        trackId: track.id,
        time: audioPlayer.currentTime || 0,
        playlistId: currentView === 'inside_playlist' ? playlistAtivaId : null
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    } catch (e) {
        console.warn("Não foi possível salvar o estado de reprodução:", e);
    }
}

// Carrega a faixa salva na tela (sem tocar automaticamente, pois os navegadores
// bloqueiam autoplay sem uma interação prévia do usuário) e posiciona no tempo salvo
function carregarFaixaParaRestaurar(index, listaAlvo, view, tempoSalvo) {
    if (index < 0 || index >= listaAlvo.length) return;
    currentView = view;
    currentTrackIndex = index;
    const track = listaAlvo[index];

    const { artista, titulo } = parseTrackInfo(track);

    document.getElementById('current-title').innerText = titulo;
    document.getElementById('current-channel').innerText = artista;
    atualizarCapaRodape(track);

    if (audioPlayer.src) { URL.revokeObjectURL(audioPlayer.src); }
    audioPlayer.src = URL.createObjectURL(track.file);

    audioPlayer.onloadedmetadata = () => {
        document.getElementById('total-duration').innerText = formatTime(audioPlayer.duration);
        if (tempoSalvo && tempoSalvo < audioPlayer.duration) {
            audioPlayer.currentTime = tempoSalvo;
            document.getElementById('current-time').innerText = formatTime(tempoSalvo);
            document.getElementById('progress-bar').value = (tempoSalvo / audioPlayer.duration) * 100;
        }
    };

    atualizarMediaSession(titulo, artista);
    navigator.mediaSession && (navigator.mediaSession.playbackState = 'paused');

    if (view === 'tracks') renderPlaylist();
}

// Tenta restaurar a última música tocada assim que a biblioteca carrega
function tentarRestaurarEstado() {
    if (stateRestaurado || !db) return;
    stateRestaurado = true;

    let estadoSalvo;
    try {
        estadoSalvo = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
        estadoSalvo = null;
    }
    if (!estadoSalvo || !estadoSalvo.trackId) return;

    if (estadoSalvo.view === 'tracks') {
        const idx = MINHA_PLAYLIST.findIndex(t => t.id === estadoSalvo.trackId);
        if (idx !== -1) carregarFaixaParaRestaurar(idx, MINHA_PLAYLIST, 'tracks', estadoSalvo.time);
    } else if (estadoSalvo.view === 'inside_playlist' && estadoSalvo.playlistId != null) {
        const transaction = db.transaction(['playlists'], 'readonly');
        const store = transaction.objectStore('playlists');
        const getReq = store.get(estadoSalvo.playlistId);
        getReq.onsuccess = () => {
            const playlist = getReq.result;
            if (!playlist) return;
            playlistAtivaId = playlist.id;
            playlistAtivaTracks = playlist.tracks;
            const idx = playlistAtivaTracks.findIndex(t => t.id === estadoSalvo.trackId);
            if (idx !== -1) carregarFaixaParaRestaurar(idx, playlistAtivaTracks, 'inside_playlist', estadoSalvo.time);
        };
    }
}

window.addEventListener('beforeunload', salvarEstadoAtual);
audioPlayer.addEventListener('pause', salvarEstadoAtual);

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

// Avança a música: se o modo aleatório estiver ativo, escolhe uma faixa aleatória
// (isso acontece tanto ao clicar em "próxima" quanto quando a música termina sozinha).
// A faixa atual sempre é empilhada no histórico antes de avançar, para que o botão
// "anterior" consiga voltar exatamente para onde o usuário estava.
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

// Volta para a música anterior. Nunca é aleatória: usa o histórico real de
// reprodução (o que realmente tocou antes), e só cai para "índice - 1" se
// não houver histórico registrado (ex: logo após restaurar o estado salvo).
function prevTrack() {
    let listaAlvo = currentView === 'tracks' ? MINHA_PLAYLIST : playlistAtivaTracks;

    if (historyStack.length > 0) {
        const indiceAnterior = historyStack.pop();
        if (indiceAnterior >= 0 && indiceAnterior < listaAlvo.length) {
            playTrack(indiceAnterior, { isBack: true });
            return;
        }
    }

    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1, { isBack: true });
}

window.deleteTrack = function(id, event) {
    event.stopPropagation();
    if (!db) return;

    const confirmado = confirm("Deseja realmente excluir esta música? Ela será apagada da biblioteca e de todas as playlists onde estiver.");
    if (!confirmado) return;

    const transaction = db.transaction(['musicas'], 'readwrite');
    const store = transaction.objectStore('musicas');
    store.delete(id);

    transaction.oncomplete = () => {
        if (currentTrackIndex !== -1 && currentView === 'tracks' && MINHA_PLAYLIST[currentTrackIndex] && MINHA_PLAYLIST[currentTrackIndex].id === id) {
            resetPlayerVisuals();
        }
        // Remove também qualquer cópia dessa música guardada dentro de playlists,
        // para não deixar dados órfãos ocupando espaço.
        removerMusicaDeTodasPlaylists(id);
        carregarPlaylist();
    };
};

// Percorre todas as playlists salvas e remove a faixa com o id informado,
// já que cada playlist guarda sua própria cópia da música.
function removerMusicaDeTodasPlaylists(trackId) {
    if (!db) return;
    const transaction = db.transaction(['playlists'], 'readwrite');
    const store = transaction.objectStore('playlists');
    const getAll = store.getAll();

    getAll.onsuccess = () => {
        const playlists = getAll.result || [];
        playlists.forEach((playlist) => {
            const tamanhoOriginal = playlist.tracks.length;
            playlist.tracks = playlist.tracks.filter((t) => t.id !== trackId);
            if (playlist.tracks.length !== tamanhoOriginal) {
                store.put(playlist);
                if (playlistAtivaId === playlist.id) playlistAtivaTracks = playlist.tracks;
            }
        });
        transaction.oncomplete = () => {
            carregarPlaylistsDB();
            if (currentView === 'inside_playlist') renderTracksOfPlaylist();
        };
    };
}

function resetPlayerVisuals() {
    audioPlayer.pause();
    isPlaying = false;
    currentTrackIndex = -1;
    document.getElementById('current-title').innerText = "Nenhuma música tocando";
    document.getElementById('current-channel').innerText = "-";
    document.getElementById('play-icon').className = "fas fa-play text-lg ml-0.5";
    document.getElementById('current-icon').className = "fas fa-music text-gray-400 text-lg";
    atualizarCapaRodape(null);
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
    playlistAtivaTracks = ordenarPorTitulo(playlist.tracks);
    currentView = 'inside_playlist';
    historyStack = []; // Histórico é por contexto de lista, então reinicia ao trocar de lista
    document.getElementById('header-title').innerText = playlist.nome;
    mostrarOuEsconderBusca(true);
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

    const query = searchQuery.trim().toLowerCase();
    let itensParaExibir = playlistAtivaTracks.map((track, index) => ({ track, index }));

    if (query) {
        itensParaExibir = itensParaExibir.filter(({ track }) => {
            const { artista, titulo } = parseTrackInfo(track);
            return titulo.toLowerCase().includes(query) || artista.toLowerCase().includes(query);
        });
    }

    if (itensParaExibir.length === 0) {
        container.innerHTML += `<p class="text-zinc-500 text-sm text-center py-8">Nenhuma música encontrada para "${searchQuery}".</p>`;
        return;
    }

    itensParaExibir.forEach(({ track, index }) => {
        const isCurrent = index === currentTrackIndex && currentView === 'inside_playlist';
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl transition ${isCurrent ? 'bg-[#1db954]/20 border border-[#1db954]' : 'bg-[#141414] border border-[#1f1f1f]'}`;
        
        const { artista, titulo } = parseTrackInfo(track);

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" id="p-track-${index}">
                ${renderCapaHtml(track, 'w-10 h-10', isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music')}
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
    const confirmado = confirm("Remover esta música da playlist? Ela continuará na sua biblioteca principal.");
    if (!confirmado) return;

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

// Mostra/esconde a caixa de busca (só faz sentido quando há uma lista de músicas visível)
function mostrarOuEsconderBusca(mostrar) {
    const searchContainer = document.getElementById('search-container');
    if (!searchContainer) return;
    searchContainer.classList.toggle('hidden', !mostrar);
}

// GERENCIADOR DE ABAS DA INTERFACE
window.switchTab = function(tab) {
    currentView = tab;
    historyStack = []; // O histórico de "anterior" é por contexto de lista, então reinicia ao trocar de aba
    searchQuery = '';
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';

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
        mostrarOuEsconderBusca(true);
        renderPlaylist();
    } else {
        tabPlaylists.className = "text-[#1db954] border-b-2 border-[#1db954] pb-1 px-1";
        tabTracks.className = "text-gray-400 pb-1 px-1 hover:text-white";
        document.getElementById('header-title').innerText = "Minhas Playlists";
        createBtn.classList.remove('hidden');
        addMusicBtn.classList.add('hidden');
        document.getElementById('add-music-form').classList.add('hidden');
        mostrarOuEsconderBusca(false);
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

document.getElementById('refresh-covers-btn').addEventListener('click', () => {
    buscarCapasFaltantes(true);
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

// Campo de busca: filtra a lista visível (biblioteca ou playlist aberta) em tempo real
const searchInputEl = document.getElementById('search-input');
if (searchInputEl) {
    searchInputEl.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        if (currentView === 'tracks') renderPlaylist();
        else if (currentView === 'inside_playlist') renderTracksOfPlaylist();
    });
}

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
    atualizarCapaRodape(listaAlvo[currentTrackIndex]); // reaplica a capa, já que as linhas acima resetam as classes do ícone
});
