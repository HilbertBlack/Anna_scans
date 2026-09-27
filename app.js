/* Application Engine State */
let scene, camera, renderer, controls, clock;
let currentModel = null;
let bboxHelper = null, gridHelper = null, axesHelper = null, shadowPlane = null;
let keyLight, fillLight, ambientLight, hemiLight;

// Animation System State
let mixer = null;
let animations = [];
let activeAction = null;
let isAnimPlaying = false;

// File/Texture Cache for relative loading
let loadedFilesMap = new Map();

let modelParams = {
    wireframe: false,
    autoRotate: false,
    rotateSpeed: 2.0,
    roughness: 0.3,
    metalness: 0.8,
    color: '#ffffff',
    renderMode: 'standard',
    lightingPreset: 'studio'
};

window.onload = function() {
    initScene();
    setupLights();
    setupHelpers();
    setupDragAndDrop();
    setupEventListeners();
    loadPreset('torusKnot');
    animate();
};

function initScene() {
    const container = document.getElementById('dropZone');
    clock = new THREE.Clock();

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d);

    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(5, 4, 7);

    // Renderer
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('threeCanvas'), 
        antialias: true,
        preserveDrawingBuffer: true 
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 200;
    controls.minDistance = 0.2;
    controls.target.set(0, 0, 0);
}

function setupLights() {
    keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(5, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    fillLight = new THREE.DirectionalLight(0x88bbff, 0.6);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.5);
    scene.add(hemiLight);
}

function setupHelpers() {
    gridHelper = new THREE.GridHelper(20, 20, 0x06b6d4, 0x334155);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    axesHelper = new THREE.AxesHelper(3);
    axesHelper.position.set(-4, 0.01, -4);
    scene.add(axesHelper);

    const shadowGeo = new THREE.PlaneGeometry(30, 30);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.01;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const prompt = document.getElementById('dragDropPrompt');

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
            if (prompt) prompt.classList.remove('opacity-0');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            if (prompt) prompt.classList.add('opacity-0');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = Array.from(dt.files);
        if (files.length > 0) {
            processUploadedFiles(files);
        }
    }, false);
}

function setupEventListeners() {
    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    const container = document.getElementById('dropZone');
    if (!container || !renderer || !camera) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function handleFileInput(event) {
    const files = Array.from(event.target.files);
    if (files.length > 0) {
        processUploadedFiles(files);
    }
}

function processUploadedFiles(files) {
    showLoader(true, "Processing FBX/GLB Model & Textures...");
    loadedFilesMap.clear();

    files.forEach(file => {
        const name = file.name.toLowerCase();
        loadedFilesMap.set(name, file);
        loadedFilesMap.set(file.name, file);
    });

    const mainModelFile = files.find(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['fbx', 'glb', 'gltf', 'obj', 'stl'].includes(ext);
    });

    if (!mainModelFile) {
        const imageFile = files.find(f => /\.(png|jpe?g|webp)$/i.test(f.name));
        if (imageFile && currentModel) {
            loadAndAssignImageFile('map', imageFile);
            showLoader(false);
            return;
        }
        showLoader(false);
        showToast("Please select a valid FBX or GLB/GLTF model file.");
        return;
    }

    const ext = mainModelFile.name.split('.').pop().toLowerCase();

    if (ext === 'fbx') loadFBXFile(mainModelFile);
    else if (ext === 'glb' || ext === 'gltf') loadGLTFFile(mainModelFile);
    else if (ext === 'obj') loadOBJFile(mainModelFile);
    else if (ext === 'stl') loadSTLFile(mainModelFile);
}

function loadFBXFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new THREE.FBXLoader();

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
        const filename = url.split('/').pop().toLowerCase();
        if (loadedFilesMap.has(filename)) {
            return URL.createObjectURL(loadedFilesMap.get(filename));
        }
        return url;
    });
    loader.manager = manager;

    loader.load(url, (fbx) => {
        fbx.name = file.name;
        removeCurrentModel();
        
        // 1. First add model to scene (this clones and saves userData.originalMaterial)
        addModelToScene(fbx);

        // 2. Extract and link embedded textures
        autoExtractAndApplyTextures(fbx);

        // 3. Setup animations if present
        setupAnimations(fbx, fbx.animations);

        // 4. Force apply active render mode (Unlit/PBR) to update with extracted maps
        applyRenderMode();

        showLoader(false);
        showToast(`Loaded FBX: ${file.name}`);
    }, 
    (xhr) => {
        if (xhr.lengthComputable) {
            const percent = (xhr.loaded / xhr.total) * 100;
            document.getElementById('loaderBar').style.width = `${percent}%`;
        }
    }, 
    (err) => {
        showLoader(false);
        showToast("Error parsing FBX model");
        console.error("FBX Load Error:", err);
    });
}

function loadGLTFFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new THREE.GLTFLoader();

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
        const filename = url.split('/').pop().toLowerCase();
        if (loadedFilesMap.has(filename)) {
            return URL.createObjectURL(loadedFilesMap.get(filename));
        }
        return url;
    });
    loader.manager = manager;

    loader.load(url, (gltf) => {
        const model = gltf.scene;
        model.name = file.name;
        removeCurrentModel();

        // 1. First add model to scene
        addModelToScene(model);

        // 2. Extract embedded textures
        autoExtractAndApplyTextures(model);

        // 3. Setup animations
        setupAnimations(model, gltf.animations);

        // 4. Force re-render mode sync
        applyRenderMode();

        showLoader(false);
        showToast(`Loaded GLB/GLTF: ${file.name}`);
    }, null, (err) => {
        showLoader(false);
        showToast("Error loading GLB/GLTF model");
        console.error(err);
    });
}

function loadOBJFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new THREE.OBJLoader();
    loader.load(url, (obj) => {
        obj.name = file.name;
        removeCurrentModel();
        autoExtractAndApplyTextures(obj);
        addModelToScene(obj);
        showLoader(false);
        showToast(`Loaded OBJ: ${file.name}`);
    }, null, (err) => {
        showLoader(false);
        showToast("Error loading OBJ model");
    });
}

function loadSTLFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new THREE.STLLoader();
    loader.load(url, (geometry) => {
        const material = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.3, metalness: 0.8 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = file.name;
        removeCurrentModel();
        addModelToScene(mesh);
        showLoader(false);
        showToast(`Loaded STL: ${file.name}`);
    }, null, (err) => {
        showLoader(false);
        showToast("Error loading STL file");
    });
}

function autoExtractAndApplyTextures(model) {
    const detectedTextures = [];

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            if (child.geometry && !child.geometry.attributes.normal) {
                child.geometry.computeVertexNormals();
            }

            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach((mat) => {
                    mat.side = THREE.DoubleSide;

                    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'bumpMap'];

                    slots.forEach((slot) => {
                        if (mat[slot]) {
                            mat[slot].encoding = THREE.sRGBEncoding;
                            mat[slot].needsUpdate = true;

                            detectedTextures.push({
                                slot: slot,
                                meshName: child.name || 'Mesh',
                                texture: mat[slot]
                            });
                        }
                    });

                    // Ensure color isn't completely black when a map is attached
                    if (mat.map) {
                        if (!mat.color || (mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0)) {
                            mat.color = new THREE.Color(0xffffff);
                        }
                    } else if (!mat.color || (mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0)) {
                        mat.color = new THREE.Color(0xd1d5db);
                    }

                    mat.needsUpdate = true;
                });

                // Keep originalMaterial reference cache in sync with extracted maps
                if (child.userData.originalMaterial) {
                    const origMats = Array.isArray(child.userData.originalMaterial) 
                        ? child.userData.originalMaterial 
                        : [child.userData.originalMaterial];
                    
                    materials.forEach((mat, idx) => {
                        if (origMats[idx]) {
                            origMats[idx].map = mat.map;
                            origMats[idx].color = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
                        }
                    });
                }
            }
        }
    });

    renderExtractedTexturesUI(detectedTextures);
}

function renderExtractedTexturesUI(detectedList) {
    const container = document.getElementById('extractedTexturesContainer');
    const countBadge = document.getElementById('extractedCountBadge');

    if (!container || !countBadge) return;

    countBadge.textContent = `${detectedList.length} Found`;

    if (detectedList.length === 0) {
        container.innerHTML = `<p class="text-center py-3 text-slate-500 text-xs">No embedded textures detected in file.</p>`;
        return;
    }

    container.innerHTML = '';

    detectedList.forEach((item) => {
        const tex = item.texture;
        let dataUrl = null;

        if (tex && tex.image) {
            try {
                if (tex.image instanceof HTMLImageElement && tex.image.src) {
                    dataUrl = tex.image.src;
                } else if (tex.image.data || tex.image instanceof HTMLCanvasElement) {
                    const canvas = document.createElement('canvas');
                    canvas.width = tex.image.width || 256;
                    canvas.height = tex.image.height || 256;
                    const ctx = canvas.getContext('2d');
                    if (tex.image instanceof HTMLCanvasElement) {
                        ctx.drawImage(tex.image, 0, 0);
                    } else if (tex.image.data) {
                        const imgData = ctx.createImageData(canvas.width, canvas.height);
                        imgData.data.set(tex.image.data);
                        ctx.putImageData(imgData, 0, 0);
                    }
                    dataUrl = canvas.toDataURL();
                }
            } catch (e) {
                console.warn("Could not extract texture preview thumbnail", e);
            }
        }

        const card = document.createElement('div');
        card.className = 'flex items-center gap-2.5 p-2 bg-slate-950/70 rounded-lg border border-slate-800';

        const thumbMarkup = dataUrl 
            ? `<img src="${dataUrl}" class="w-10 h-10 object-cover rounded-md border border-slate-700 shrink-0">` 
            : `<div class="w-10 h-10 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0"><i class="fa-solid fa-image text-cyan-400 text-xs"></i></div>`;

        const slotLabel = item.slot === 'map' ? 'Base Color' : item.slot;
        
        // Extracted dimensions variables to avoid nested template literal string parsing errors
        const texWidth = (tex && tex.image && tex.image.width) ? tex.image.width : '2D';
        const texHeight = (tex && tex.image && tex.image.height) ? tex.image.height : 'Tex';
        const dimString = `${texWidth}x${texHeight}`;

        card.innerHTML = `
            ${thumbMarkup}
            <div class="overflow-hidden flex-1">
                <span class="font-semibold text-slate-200 block text-xs truncate">${slotLabel}</span>
                <span class="text-[10px] text-slate-400 block truncate">${item.meshName}</span>
                <span class="text-[9px] text-cyan-400 font-mono">${dimString}</span>
            </div>
        `;

        container.appendChild(card);

        if (item.slot === 'map' && dataUrl) {
            updateTextureSlotUI('map', `${item.meshName}_embedded`, dataUrl);
        }
    });
}

function loadPreset(presetType) {
    showLoader(true, "Generating Preset Model...");
    
    document.querySelectorAll('.preset-btn').forEach(btn => {
        if (btn.dataset.preset === presetType) {
            btn.classList.add('bg-slate-800', 'text-cyan-300', 'border-slate-700');
            btn.classList.remove('border-transparent', 'text-slate-400');
        } else {
            btn.classList.remove('bg-slate-800', 'text-cyan-300', 'border-slate-700');
            btn.classList.add('border-transparent', 'text-slate-400');
        }
    });

    setTimeout(() => {
        removeCurrentModel();

        let group = new THREE.Group();

        if (presetType === 'torusKnot') {
            const geometry = new THREE.TorusKnotGeometry(1.2, 0.4, 150, 32);
            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color('#06b6d4'),
                roughness: modelParams.roughness,
                metalness: modelParams.metalness,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
            group.name = "CyberKnot";

        } else if (presetType === 'cyberHelmet') {
            group.name = "SciFiHelmet";
            const coreGeo = new THREE.IcosahedronGeometry(1.2, 2);
            const coreMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.9 });
            const core = new THREE.Mesh(coreGeo, coreMat);
            core.castShadow = true;
            group.add(core);

            const ringGeo = new THREE.TorusGeometry(1.4, 0.12, 16, 64);
            const ringMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.1, metalness: 0.9 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 3;
            group.add(ring);

        } else if (presetType === 'texturedSphere') {
            group.name = "TexturedEarth";
            const geometry = new THREE.SphereGeometry(1.4, 64, 64);

            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1e3a8a'; ctx.fillRect(0, 0, 512, 256);
            ctx.fillStyle = '#10b981';
            for(let i=0; i<15; i++) {
                ctx.beginPath();
                ctx.arc(Math.random()*512, Math.random()*256, 30 + Math.random()*50, 0, Math.PI*2);
                ctx.fill();
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.encoding = THREE.sRGBEncoding;

            const material = new THREE.MeshStandardMaterial({
                map: tex,
                roughness: 0.4,
                metalness: 0.2
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            group.add(mesh);
        }

        autoExtractAndApplyTextures(group);
        addModelToScene(group);
        showLoader(false);
        showToast(`Loaded ${group.name}`);
    }, 150);
}

function addModelToScene(model) {
    currentModel = model;

    currentModel.traverse((child) => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            
            materials.forEach(mat => {
                mat.side = THREE.DoubleSide;
                
                if (mat.map) {
                    if (mat.color && (mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0)) {
                        mat.color.setHex(0xffffff);
                    }
                } else if (mat.color && (mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0)) {
                    mat.color.setHex(0xd1d5db);
                }
            });

            if (!child.userData.originalMaterial) {
                if (Array.isArray(child.material)) {
                    child.userData.originalMaterial = child.material.map(m => m.clone());
                } else {
                    child.userData.originalMaterial = child.material.clone();
                }
            }
        }
    });

    scene.add(currentModel);

    const box = new THREE.Box3().setFromObject(currentModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    currentModel.position.x += (currentModel.position.x - center.x);
    currentModel.position.y += (currentModel.position.y - center.y);
    currentModel.position.z += (currentModel.position.z - center.z);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
        const targetScale = 3.2 / maxDim;
        currentModel.scale.set(targetScale, targetScale, targetScale);
    }

    const updatedBox = new THREE.Box3().setFromObject(currentModel);
    currentModel.position.y -= updatedBox.min.y;

    if (bboxHelper) scene.remove(bboxHelper);
    bboxHelper = new THREE.BoxHelper(currentModel, 0x06b6d4);
    bboxHelper.visible = document.getElementById('chkBBox').checked;
    scene.add(bboxHelper);

    updateModelStats(currentModel, size);
    applyRenderMode();
    resetCamera();
    inspectExistingTextures();
}

function removeCurrentModel() {
    if (mixer) {
        mixer.stopAllAction();
        mixer = null;
    }
    animations = [];
    hideAnimationPlayer();

    if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            }
        });
        currentModel = null;
    }
    if (bboxHelper) {
        scene.remove(bboxHelper);
        bboxHelper = null;
    }
}

function setupAnimations(model, animList) {
    if (!animList || animList.length === 0) {
        hideAnimationPlayer();
        return;
    }

    animations = animList;
    mixer = new THREE.AnimationMixer(model);

    const animSelect = document.getElementById('animSelect');
    animSelect.innerHTML = '';

    animations.forEach((anim, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = anim.name || `Anim ${idx + 1}`;
        animSelect.appendChild(opt);
    });

    document.getElementById('animPlayerBar').classList.remove('hidden');
    selectAnimation(0);
    playAnimation();
}

function selectAnimation(index) {
    if (!mixer || !animations[index]) return;
    if (activeAction) activeAction.stop();

    const clip = animations[index];
    activeAction = mixer.clipAction(clip);
    activeAction.play();

    document.getElementById('animTimeTotal').textContent = `${clip.duration.toFixed(1)}s`;
    isAnimPlaying = true;
    updateAnimPlayIcon();
}

function togglePlayPauseAnim() {
    if (!activeAction) return;
    isAnimPlaying = !isAnimPlaying;
    activeAction.paused = !isAnimPlaying;
    updateAnimPlayIcon();
}

function playAnimation() {
    if (!activeAction) return;
    isAnimPlaying = true;
    activeAction.paused = false;
    updateAnimPlayIcon();
}

function updateAnimPlayIcon() {
    const icon = document.getElementById('iconPlayAnim');
    icon.className = isAnimPlaying ? 'fa-solid fa-pause text-xs' : 'fa-solid fa-play text-xs';
}

function scrubAnimation(percent) {
    if (!activeAction || !activeAction.getClip()) return;
    const duration = activeAction.getClip().duration;
    const targetTime = (percent / 100) * duration;
    mixer.setTime(targetTime);
}

function hideAnimationPlayer() {
    document.getElementById('animPlayerBar').classList.add('hidden');
}

function assignCustomTexture(slotName, event) {
    const file = event.target.files[0];
    if (!file) return;
    loadAndAssignImageFile(slotName, file);
}

function loadAndAssignImageFile(slotName, file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(e.target.result, (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.encoding = THREE.sRGBEncoding;

            if (currentModel) {
                currentModel.traverse((child) => {
                    if (child.isMesh) {
                        if (child.material) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(m => {
                                m[slotName] = texture;
                                if (slotName === 'map' && m.color) m.color.setHex(0xffffff);
                                m.needsUpdate = true;
                            });
                        }

                        if (child.userData.originalMaterial) {
                            const origMats = Array.isArray(child.userData.originalMaterial) 
                                ? child.userData.originalMaterial 
                                : [child.userData.originalMaterial];
                            origMats.forEach(om => {
                                om[slotName] = texture;
                                if (slotName === 'map' && om.color) om.color.setHex(0xffffff);
                                om.needsUpdate = true;
                            });
                        }
                    }
                });

                showToast(`Assigned ${slotName} map`);
                updateTextureSlotUI(slotName, file.name, e.target.result);
                applyRenderMode();
            }
        });
    };
    reader.readAsDataURL(file);
}

function inspectExistingTextures() {
    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap'];
    slots.forEach(slot => {
        let foundTex = null;
        if (currentModel) {
            currentModel.traverse((child) => {
                if (child.isMesh && child.material && child.material[slot]) {
                    foundTex = child.material[slot];
                }
            });
        }
        
        const statusEl = document.getElementById(`status-${slot}`);
        if (statusEl) {
            if (foundTex) {
                statusEl.textContent = "Active Map";
                statusEl.className = "text-[10px] text-cyan-400 font-medium";
            } else {
                statusEl.textContent = "None";
                statusEl.className = "text-[10px] text-slate-500";
            }
        }
    });
}

function updateTextureSlotUI(slotName, fileName, previewUrl) {
    const statusEl = document.getElementById(`status-${slotName}`);
    const thumbEl = document.getElementById(`thumb-${slotName}`);

    if (statusEl) {
        statusEl.textContent = fileName;
        statusEl.className = "text-[10px] text-cyan-400 truncate max-w-[100px]";
    }
    if (thumbEl && previewUrl) {
        thumbEl.innerHTML = `<img src="${previewUrl}" class="w-full h-full object-cover">`;
    }
}

function updateTextureUV() {
    const repeatU = parseFloat(document.getElementById('sliderRepeatU').value);
    const repeatV = parseFloat(document.getElementById('sliderRepeatV').value);

    document.getElementById('repeatUVal').textContent = repeatU.toFixed(1);
    document.getElementById('repeatVVal').textContent = repeatV.toFixed(1);

    if (!currentModel) return;

    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap'];
    currentModel.traverse((child) => {
        if (child.isMesh && child.material) {
            slots.forEach(slot => {
                if (child.material[slot]) {
                    child.material[slot].repeat.set(repeatU, repeatV);
                    child.material[slot].needsUpdate = true;
                }
            });
        }
    });
}

function setRenderMode(mode) {
    modelParams.renderMode = mode;
    
    document.querySelectorAll('.render-mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('bg-slate-800', 'text-cyan-300', 'border-cyan-500/50');
            btn.classList.remove('bg-slate-900/60', 'text-slate-400', 'border-slate-800');
        } else {
            btn.classList.remove('bg-slate-800', 'text-cyan-300', 'border-cyan-500/50');
            btn.classList.add('bg-slate-900/60', 'text-slate-400', 'border-slate-800');
        }
    });

    applyRenderMode();
}

function applyRenderMode() {
    if (!currentModel) return;

    // Reset default scene lighting state first
    if (modelParams.renderMode === 'ambientPBR') {
        keyLight.intensity = 0;
        keyLight.castShadow = false;

        fillLight.intensity = 0;
        ambientLight.intensity = 1.2;
        ambientLight.color.setHex(0xffffff);

        hemiLight.intensity = 0;
    } else {
        // Restore active lighting preset values
        setLightingPreset(modelParams.lightingPreset || 'studio');
    }

    currentModel.traverse((child) => {
        if (child.isMesh) {
            const getMat = (m) => Array.isArray(m) ? m[0] : m;
            const activeMat = child.material ? getMat(child.material) : null;
            const origMat = child.userData.originalMaterial ? getMat(child.userData.originalMaterial) : activeMat;

            if (modelParams.renderMode === 'ambientPBR') {
                // Restore original materials but disable directional shading effects
                if (child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }

                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    m.wireframe = false;
                    m.roughness = 1.0; // Eliminates specular highlights
                    m.metalness = 0.0; // Eliminates metallic reflections
                    m.needsUpdate = true;
                });

            } else if (modelParams.renderMode === 'unlit') {
                const activeMap = (origMat && origMat.map) || 
                                  (activeMat && activeMat.map) || 
                                  (origMat && origMat.emissiveMap) || 
                                  (activeMat && activeMat.emissiveMap) || null;
                
                const baseColor = (origMat && origMat.color) ? origMat.color : ((activeMat && activeMat.color) ? activeMat.color : new THREE.Color(0xffffff));
                const targetColor = activeMap ? new THREE.Color(0xffffff) : baseColor.clone();

                const unlitMat = new THREE.MeshBasicMaterial({
                    map: activeMap,
                    color: targetColor,
                    wireframe: false,
                    side: THREE.DoubleSide,
                    vertexColors: false
                });

                if (activeMap) {
                    activeMap.encoding = THREE.sRGBEncoding;
                    activeMap.needsUpdate = true;
                }

                child.material = unlitMat;

            } else if (modelParams.renderMode === 'wireframe') {
                if (child.userData.originalMaterial) child.material = child.userData.originalMaterial;
                child.material.wireframe = true;

            } else if (modelParams.renderMode === 'normals') {
                child.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

            } else if (modelParams.renderMode === 'glass') {
                child.material = new THREE.MeshPhysicalMaterial({
                    color: new THREE.Color(modelParams.color),
                    roughness: 0.1,
                    metalness: 0.1,
                    transmission: 0.8,
                    transparent: true,
                    opacity: 1,
                    side: THREE.DoubleSide
                });

            } else { // Standard PBR Mode
                if (child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }
                
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    m.wireframe = false;
                    if (m.roughness !== undefined) m.roughness = modelParams.roughness;
                    if (m.metalness !== undefined) m.metalness = modelParams.metalness;
                    m.needsUpdate = true;
                });
            }
        }
    });
}

function setCameraView(view) {
    if (!currentModel) return;
    const box = new THREE.Box3().setFromObject(currentModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.5;

    controls.target.copy(center);

    if (view === 'front') camera.position.set(center.x, center.y, center.z + dist);
    else if (view === 'top') camera.position.set(center.x, center.y + dist, center.z + 0.001);
    else if (view === 'side') camera.position.set(center.x + dist, center.y, center.z);
    else if (view === 'iso') camera.position.set(center.x + dist, center.y + dist, center.z + dist);

    controls.update();
}

function setLightingPreset(preset) {
    modelParams.lightingPreset = preset;

    document.querySelectorAll('.light-preset-btn').forEach(btn => {
        if (btn.dataset.env === preset) {
            btn.classList.add('bg-slate-800', 'text-cyan-300', 'border-cyan-500/50');
            btn.classList.remove('bg-slate-900/60', 'text-slate-400', 'border-slate-800');
        } else {
            btn.classList.remove('bg-slate-800', 'text-cyan-300', 'border-cyan-500/50');
            btn.classList.add('bg-slate-900/60', 'text-slate-400', 'border-slate-800');
        }
    });

    if (preset === 'studio') {
        keyLight.color.setHex(0xffffff); keyLight.intensity = 1.2;
        fillLight.color.setHex(0x88bbff); fillLight.intensity = 0.6;
        ambientLight.intensity = 0.4;
    } else if (preset === 'sunset') {
        keyLight.color.setHex(0xf59e0b); keyLight.intensity = 1.8;
        fillLight.color.setHex(0x3b82f6); fillLight.intensity = 0.4;
        ambientLight.intensity = 0.3;
    } else if (preset === 'cyberpunk') {
        keyLight.color.setHex(0xec4899); keyLight.intensity = 2.0;
        fillLight.color.setHex(0x06b6d4); fillLight.intensity = 1.5;
        ambientLight.intensity = 0.2;
    } else if (preset === 'forest') {
        keyLight.color.setHex(0xa7f3d0); keyLight.intensity = 1.4;
        fillLight.color.setHex(0x0284c7); fillLight.intensity = 0.5;
        ambientLight.intensity = 0.5;
    }

    document.getElementById('sliderKeyLight').value = keyLight.intensity;
    document.getElementById('keyLightVal').textContent = keyLight.intensity.toFixed(1);
    document.getElementById('sliderFillLight').value = fillLight.intensity;
    document.getElementById('fillLightVal').textContent = fillLight.intensity.toFixed(1);
    document.getElementById('sliderAmbientLight').value = ambientLight.intensity;
    document.getElementById('ambientLightVal').textContent = ambientLight.intensity.toFixed(1);
}

function updateLightIntensity(type, value) {
    const val = parseFloat(value);
    if (type === 'key') { keyLight.intensity = val; document.getElementById('keyLightVal').textContent = val.toFixed(1); }
    if (type === 'fill') { fillLight.intensity = val; document.getElementById('fillLightVal').textContent = val.toFixed(1); }
    if (type === 'ambient') { ambientLight.intensity = val; document.getElementById('ambientLightVal').textContent = val.toFixed(1); }
}

function setBgMode(mode) {
    if (mode === 'dark') scene.background = new THREE.Color(0x0a0f1d);
    else if (mode === 'slate') scene.background = new THREE.Color(0x1e293b);
    else if (mode === 'indigo') scene.background = new THREE.Color(0x020617);
    else if (mode === 'light') scene.background = new THREE.Color(0xe2e8f0);
}

function setCustomBgColor(hex) { scene.background = new THREE.Color(hex); }
function toggleGrid(show) { if (gridHelper) gridHelper.visible = show; }
function toggleAxes(show) { if (axesHelper) axesHelper.visible = show; }
function toggleBoundingBox(show) { if (bboxHelper) bboxHelper.visible = show; }
function toggleShadows(show) { if (shadowPlane) shadowPlane.visible = show; }

function setAutoRotate(enabled) {
    modelParams.autoRotate = enabled;
    controls.autoRotate = enabled;
}

function updateRotateSpeed(speed) {
    modelParams.rotateSpeed = parseFloat(speed);
    controls.autoRotateSpeed = modelParams.rotateSpeed;
    document.getElementById('speedVal').textContent = parseFloat(speed).toFixed(1);
}

function reduceRoughness(delta = 0.2) {
    const current = modelParams.roughness !== undefined ? modelParams.roughness : 0.3;
    const newVal = Math.max(0, current - delta);
    setRoughnessValue(newVal);
    showToast(`Surface polished! Roughness set to ${newVal.toFixed(2)}`);
}

function setRoughnessValue(val) {
    const numericVal = Math.max(0, Math.min(1, parseFloat(val)));
    modelParams.roughness = numericVal;
    
    const slider = document.getElementById('sliderRoughness');
    if (slider) slider.value = numericVal;
    
    const valLabel = document.getElementById('roughnessVal');
    if (valLabel) valLabel.textContent = numericVal.toFixed(2);
    
    if (currentModel) {
        currentModel.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.roughness !== undefined) {
                        mat.roughness = numericVal;
                        mat.needsUpdate = true;
                    }
                });
            }
        });
    }
}

function updateMaterialParam(param, value) {
    modelParams[param] = parseFloat(value);
    if (param === 'roughness') document.getElementById('roughnessVal').textContent = parseFloat(value).toFixed(2);
    if (param === 'metalness') document.getElementById('metalnessVal').textContent = parseFloat(value).toFixed(2);
    
    if (currentModel) {
        currentModel.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat[param] !== undefined) {
                        mat[param] = parseFloat(value);
                        mat.needsUpdate = true;
                    }
                });
            }
        });
    }
}

function updateMaterialColor(colorHex) {
    modelParams.color = colorHex;
    if (currentModel) {
        currentModel.traverse((child) => {
            if (child.isMesh && child.material && child.material.color) {
                child.material.color.set(colorHex);
            }
        });
    }
}

function updateModelStats(object, originalSize) {
    let vertexCount = 0;
    let faceCount = 0;
    let meshCount = 0;
    let matSet = new Set();

    object.traverse((child) => {
        if (child.isMesh) {
            meshCount++;
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => matSet.add(m.uuid));
                else matSet.add(child.material.uuid);
            }

            const geom = child.geometry;
            if (geom) {
                if (geom.index) faceCount += geom.index.count / 3;
                else if (geom.attributes.position) faceCount += geom.attributes.position.count / 3;
                if (geom.attributes.position) vertexCount += geom.attributes.position.count;
            }
        }
    });

    document.getElementById('statVertices').textContent = vertexCount.toLocaleString();
    document.getElementById('statFaces').textContent = Math.round(faceCount).toLocaleString();
    document.getElementById('statMeshCount').textContent = meshCount;
    document.getElementById('statMatCount').textContent = matSet.size;
    document.getElementById('statAnimCount').textContent = animations.length;
    document.getElementById('modelNameBadge').textContent = object.name || 'Model';

    document.getElementById('dimX').textContent = originalSize.x.toFixed(2);
    document.getElementById('dimY').textContent = originalSize.y.toFixed(2);
    document.getElementById('dimZ').textContent = originalSize.z.toFixed(2);
}

function resetCamera() {
    if (!currentModel) return;
    const box = new THREE.Box3().setFromObject(currentModel);
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.set(center.x + 4, center.y + 3, center.z + 5);
    controls.update();
}

function captureSnapshot() {
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `3d-studio-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
    showToast("Snapshot saved!");
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        document.getElementById('fullscreenIcon').className = 'fa-solid fa-compress';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
            document.getElementById('fullscreenIcon').className = 'fa-solid fa-expand';
        }
    }
}

function resetAllSettings() {
    setRenderMode('standard');
    setLightingPreset('studio');
    setBgMode('dark');
    setAutoRotate(false);
    
    document.getElementById('chkGrid').checked = true;
    document.getElementById('chkAxes').checked = true;
    document.getElementById('chkBBox').checked = false;
    document.getElementById('chkShadow').checked = true;
    toggleGrid(true);
    toggleAxes(true);
    toggleBoundingBox(false);
    toggleShadows(true);

    resetCamera();
    showToast("Settings reset");
}

function showLoader(show, text = "") {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loaderText');
    const loaderBar = document.getElementById('loaderBar');
    if (!loader) return;
    if (show) {
        if (text && loaderText) loaderText.textContent = text;
        if (loaderBar) loaderBar.style.width = '0%';
        loader.classList.remove('opacity-0', 'pointer-events-none');
    } else {
        loader.classList.add('opacity-0', 'pointer-events-none');
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    if (toast && toastMsg) {
        toastMsg.textContent = msg;
        toast.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
        setTimeout(() => {
            toast.classList.add('opacity-0', 'pointer-events-none', '-translate-y-2');
            toast.classList.remove('opacity-100', 'translate-y-0');
        }, 3000);
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('bg-cyan-600', 'text-white');
        el.classList.add('text-slate-400');
    });

    const contentEl = document.getElementById(`content-${tabName}`);
    if (contentEl) contentEl.classList.remove('hidden');

    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeTab) {
        activeTab.classList.add('bg-cyan-600', 'text-white');
        activeTab.classList.remove('text-slate-400');
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (mixer && isAnimPlaying) {
        mixer.update(delta);
        if (activeAction && activeAction.getClip()) {
            const current = activeAction.time;
            const duration = activeAction.getClip().duration;
            document.getElementById('animTimeCurrent').textContent = `${current.toFixed(1)}s`;
            document.getElementById('animProgress').value = (current / duration) * 100;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}