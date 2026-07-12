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

// ============================================================================
// CAPAS DE ÁLBUM — extraídas diretamente do arquivo de áudio, sem internet.
// .mp3 usa tags ID3v2 (lidas pela biblioteca jsmediatags).
// .opus/.ogg guardam a capa num comentário Vorbis "METADATA_BLOCK_PICTURE"
// (um bloco de imagem no formato do FLAC, em base64), que é lido manualmente
// abaixo já que não existe uma biblioteca pronta e leve para isso.
// ============================================================================

// capaCache: track.id -> URL do objeto (string) quando há capa, ou null quando já
// verificamos e não encontramos nenhuma capa embutida no arquivo.
const capaCache = new Map();

function extrairCapaID3(file) {
    return new Promise((resolve) => {
        if (typeof jsmediatags === 'undefined') { resolve(null); return; }
        new jsmediatags.Reader(file)
            .setTagsToRead(['picture'])
            .read({
                onSuccess: (tag) => {
                    const picture = tag.tags && tag.tags.picture;
                    if (!picture || !picture.data) { resolve(null); return; }
                    try {
                        const bytes = new Uint8Array(picture.data);
                        const blob = new Blob([bytes], { type: picture.format || 'image/jpeg' });
                        resolve(URL.createObjectURL(blob));
                    } catch (e) {
                        resolve(null);
                    }
                },
                onError: () => resolve(null)
            });
    });
}

// Reconstrói os "pacotes" lógicos do container Ogg a partir das páginas físicas
// (um pacote pode estar espalhado por várias páginas quando é grande, como
// acontece quando há uma capa embutida no cabeçalho de comentários).
function extrairPacotesOgg(bytes, quantidadeDesejada) {
    const pacotes = [];
    let offset = 0;
    let pacoteEmMontagem = null;

    while (offset + 27 <= bytes.length && pacotes.length < quantidadeDesejada) {
        if (!(bytes[offset] === 0x4f && bytes[offset + 1] === 0x67 && bytes[offset + 2] === 0x67 && bytes[offset + 3] === 0x53)) {
            break; // não é o início de uma página Ogg válida ("OggS")
        }
        const pageSegments = bytes[offset + 26];
        const tabelaInicio = offset + 27;
        if (tabelaInicio + pageSegments > bytes.length) break;
        const tabelaSegmentos = bytes.slice(tabelaInicio, tabelaInicio + pageSegments);
        let posicaoDados = tabelaInicio + pageSegments;

        let i = 0;
        while (i < tabelaSegmentos.length) {
            let tamanhoPacote = 0;
            let tamanhoSegmento;
            do {
                tamanhoSegmento = tabelaSegmentos[i];
                tamanhoPacote += tamanhoSegmento;
                i++;
            } while (tamanhoSegmento === 255 && i < tabelaSegmentos.length);

            if (posicaoDados + tamanhoPacote > bytes.length) { posicaoDados = bytes.length; break; }
            const pedaco = bytes.slice(posicaoDados, posicaoDados + tamanhoPacote);
            posicaoDados += tamanhoPacote;

            if (pacoteEmMontagem) {
                pacoteEmMontagem.push(pedaco);
            } else {
                pacoteEmMontagem = [pedaco];
            }

            const terminaNoFimDaPagina = (i === tabelaSegmentos.length);
            const ultimoSegmentoEra255 = (tamanhoSegmento === 255);

            // Se a página terminou bem no meio de um pacote (último segmento = 255),
            // o pacote continua na próxima página; caso contrário está completo.
            if (!(ultimoSegmentoEra255 && terminaNoFimDaPagina)) {
                const total = pacoteEmMontagem.reduce((soma, p) => soma + p.length, 0);
                const completo = new Uint8Array(total);
                let pos = 0;
                for (const p of pacoteEmMontagem) { completo.set(p, pos); pos += p.length; }
                pacotes.push(completo);
                pacoteEmMontagem = null;
                if (pacotes.length >= quantidadeDesejada) break;
            }
        }

        offset = posicaoDados;
    }

    return pacotes;
}

// Lê os comentários de um pacote "OpusTags" (Opus) ou de cabeçalho de comentário Vorbis (.ogg)
function lerComentariosVorbis(packet) {
    let offset;
    const decoderAscii = new TextDecoder('ascii');
    const inicioOpus = decoderAscii.decode(packet.slice(0, 8));
    if (inicioOpus === 'OpusTags') {
        offset = 8;
    } else if (packet[0] === 0x03 && decoderAscii.decode(packet.slice(1, 7)) === 'vorbis') {
        offset = 7;
    } else {
        return null; // não é um pacote de tags Opus/Vorbis reconhecido
    }

    const dv = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const vendorLen = dv.getUint32(offset, true); offset += 4 + vendorLen;
    if (offset + 4 > packet.length) return null;
    const commentCount = dv.getUint32(offset, true); offset += 4;

    const comentarios = [];
    for (let i = 0; i < commentCount; i++) {
        if (offset + 4 > packet.length) break;
        const len = dv.getUint32(offset, true); offset += 4;
        comentarios.push(packet.slice(offset, offset + len));
        offset += len;
    }
    return comentarios;
}

function base64ParaBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

// Decodifica um bloco de imagem no formato do FLAC (mesma estrutura usada no METADATA_BLOCK_PICTURE)
function lerBlocoImagemFlac(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4; // tipo da imagem (ignorado)
    const mimeLen = dv.getUint32(offset, false); offset += 4;
    const mime = new TextDecoder('utf-8').decode(bytes.slice(offset, offset + mimeLen)); offset += mimeLen;
    const descLen = dv.getUint32(offset, false); offset += 4 + descLen;
    offset += 4 + 4 + 4 + 4; // largura, altura, profundidade de cor, nº de cores indexadas
    const dataLen = dv.getUint32(offset, false); offset += 4;
    const data = bytes.slice(offset, offset + dataLen);
    return { mime, data };
}

async function extrairCapaOgg(file) {
    try {
        // Os cabeçalhos + a capa embutida cabem tranquilamente nos primeiros MBs do arquivo;
        // não é preciso ler a música inteira só para achar a imagem.
        const tamanhoLeitura = Math.min(file.size, 8 * 1024 * 1024);
        const buffer = await file.slice(0, tamanhoLeitura).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        const pacotes = extrairPacotesOgg(bytes, 2);
        if (pacotes.length < 2) return null;

        const comentarios = lerComentariosVorbis(pacotes[1]);
        if (!comentarios) return null;

        const decoder = new TextDecoder('utf-8');
        const prefixo = 'METADATA_BLOCK_PICTURE=';
        for (const comentarioBytes of comentarios) {
            const texto = decoder.decode(comentarioBytes);
            if (texto.toUpperCase().startsWith(prefixo)) {
                const imagem = lerBlocoImagemFlac(base64ParaBytes(texto.slice(prefixo.length)));
                const blob = new Blob([imagem.data], { type: imagem.mime || 'image/jpeg' });
                return URL.createObjectURL(blob);
            }
        }
        return null;
    } catch (e) {
        console.warn('Não foi possível extrair a capa deste arquivo .ogg/.opus:', e);
        return null;
    }
}

// Ponto único de entrada: decide o método certo pela extensão do arquivo e usa cache
function obterCapa(track) {
    if (capaCache.has(track.id)) return Promise.resolve(capaCache.get(track.id));

    const nome = (track.name || '').toLowerCase();
    let promessa;
    if (nome.endsWith('.mp3')) {
        promessa = extrairCapaID3(track.file);
    } else if (nome.endsWith('.ogg') || nome.endsWith('.opus')) {
        promessa = extrairCapaOgg(track.file);
    } else {
        promessa = Promise.resolve(null);
    }

    return promessa
        .then((url) => { capaCache.set(track.id, url); return url; })
        .catch(() => { capaCache.set(track.id, null); return null; });
}

// Depois de inserir a miniatura padrão (ícone) na tela, tenta carregar a capa real em
// segundo plano e substitui o ícone pela imagem quando (e se) ela for encontrada.
function iniciarCarregamentoCapa(track, elementId) {
    obterCapa(track).then((url) => {
        if (!url) return;
        const el = document.getElementById(elementId);
        if (!el) return; // a lista pode ter sido re-renderizada/filtrada nesse meio tempo
        el.innerHTML = `<img src="${url}" class="w-full h-full object-cover" alt="Capa do álbum">`;
    });
}

// Atualiza a capa mostrada no rodapé (player), cancelando resultados desatualizados
// caso o usuário troque de música antes da extração terminar.
let tokenCapaAtual = 0;
function atualizarCapaRodape(track) {
    const meuToken = ++tokenCapaAtual;
    const img = document.getElementById('current-thumb-img');
    img.classList.add('hidden');

    const capaExistente = capaCache.get(track.id);
    if (capaExistente) {
        img.src = capaExistente;
        img.classList.remove('hidden');
        return;
    }
    if (capaExistente === null) return; // já sabemos que esta faixa não tem capa

    obterCapa(track).then((url) => {
        if (meuToken !== tokenCapaAtual || !url) return; // música já trocou, ou não achou capa
        img.src = url;
        img.classList.remove('hidden');
    });
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
        const capaExistente = capaCache.get(track.id);
        const thumbId = `thumb-${track.id}`;

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" id="track-click-${index}">
                <div class="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-gray-400 border border-white/5 overflow-hidden" id="${thumbId}">
                    ${capaExistente ? `<img src="${capaExistente}" class="w-full h-full object-cover" alt="Capa do álbum">` : `<i class="fas ${isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music'}"></i>`}
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

        if (capaExistente === undefined) iniciarCarregamentoCapa(track, thumbId);
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
    document.getElementById('current-thumb-img').classList.add('hidden');
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
        const capaExistente = capaCache.get(track.id);
        const thumbId = `pthumb-${track.id}`;

        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" id="p-track-${index}">
                <div class="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-gray-400 text-xs overflow-hidden" id="${thumbId}">
                    ${capaExistente ? `<img src="${capaExistente}" class="w-full h-full object-cover" alt="Capa do álbum">` : `<i class="fas ${isCurrent && isPlaying ? 'fa-volume-up text-[#1db954]' : 'fa-music'}"></i>`}
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

        if (capaExistente === undefined) iniciarCarregamentoCapa(track, thumbId);
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
});
