(function() {
    var width = window.innerWidth * 0.995;
    var height = window.innerHeight * 0.995;
    var canvasContainer = document.getElementById("canvasContainer");
    var renderer, camera, scene;
    var input, miniMap, levelHelper, CameraHelper;
    var map = new Array();
    var running = true;

    // --- Pointer Lock (mouse look) state ---
    var _plActive = false;
    var _mouseSensitivity = 0.002; // 略微调整灵敏度

    // --- WASD 键状态（与方向键并行） ---
    var _keys = { w: false, a: false, s: false, d: false };

    // --- 透视导航变量 ---
    var guideLine; // 导航线对象
    var exitPosition = new THREE.Vector3(); // 终点坐标
    var hasExit = false; // 是否找到终点

    // === Minimap (Labyrinth-style) config & helpers ===
    var mapScale = 16; // 每个地图格在小地图上的像素尺寸
    function $(id){ return document.getElementById(id); }
    function isWallCellByValue(v){ return (v != 1 && !isNaN(v)); }
    // 世界坐标 -> 连续网格坐标（浮点）
    function worldToTileFloat(wx, wz) {
        var tileSize = 100;
        var platformWidth = map[0].length * tileSize;
        var platformHeight = map.length * tileSize;
        var tx = (wx + platformWidth/2) / tileSize + 0.2;
        var ty = (wz + platformHeight/2) / tileSize + 0.4;
        return { tx: tx, ty: ty };
    }

    function initializeEngine() {
        renderer = new THREE.WebGLRenderer({
            antialias: true
        });

        renderer.setSize(width, height);
        renderer.clear();

        scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x777777, 25, 1000);

        camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
        camera.position.y = 50;

        document.getElementById("canvasContainer").appendChild(renderer.domElement);

        input = new Demonixis.Input();
        levelHelper = new Demonixis.GameHelper.LevelHelper();
        cameraHelper = new Demonixis.GameHelper.CameraHelper(camera);
        cameraHelper.translation = 5; // 稍微加快一点移动速度便于测试
        cameraHelper.rotation    = 0.04;

        // 修正：窗口改变时同时更新相机宽高比
        window.addEventListener("resize", function() {
            var w = window.innerWidth;
            var h = window.innerHeight;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        });

        // WASD 键监听（与方向键并行）
        window.addEventListener("keydown", function(e) {
            var k = e.key.toLowerCase();
            if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
                _keys[k] = true;
            }
        });
        window.addEventListener("keyup", function(e) {
            var k = e.key.toLowerCase();
            if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
                _keys[k] = false;
            }
        });

        var messageContainer = document.createElement("div");
        messageContainer.style.position = "absolute";
        messageContainer.style.backgroundColor = "#666";
        messageContainer.style.border = "1px solid #333";

        var message = document.createElement("h1");
        message.innerHTML = "Click to Start.<br>Use ARROW keys or WASD to move.<br><span style='color:#00ffff'>X-RAY VISION ACTIVATED</span>";
        message.style.textAlign = "center";
        message.style.color = "#ddd";
        message.style.padding = "15px";
        messageContainer.appendChild(message);

        document.body.appendChild(messageContainer);

        messageContainer.style.left = (window.innerWidth / 2 - messageContainer.offsetWidth / 2) + "px";
        messageContainer.style.top = (window.innerHeight / 2 - messageContainer.offsetHeight / 2) + "px";

        var timer = setTimeout(function() {
            clearTimeout(timer);
            if(document.body.contains(messageContainer)) {
                document.body.removeChild(messageContainer);
            }
        }, 5000);

        // 初始化鼠标指针锁（鼠标视角）
        setupPointerLock();
    }

    // 鼠标指针锁 + 鼠标移动控制视角
    function setupPointerLock() {
        var el = renderer.domElement;

        function onPointerLockChange() {
            var locked = (document.pointerLockElement === el) ||
                         (document.mozPointerLockElement === el) ||
                         (document.webkitPointerLockElement === el);
            _plActive = !!locked;
        }

        function onPointerLockError() {
            console.warn("PointerLock error");
            _plActive = false;
        }

        function onMouseMove(e) {
            if (!_plActive) return;
            var movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
            camera.rotation.y -= movementX * _mouseSensitivity;
        }

        el.addEventListener('click', function () {
            if (el.requestPointerLock) el.requestPointerLock();
            else if (el.mozRequestPointerLock) el.mozRequestPointerLock();
            else if (el.webkitRequestPointerLock) el.webkitRequestPointerLock();
        });

        document.addEventListener('pointerlockchange', onPointerLockChange, false);
        document.addEventListener('mozpointerlockchange', onPointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', onPointerLockChange, false);

        document.addEventListener('pointerlockerror', onPointerLockError, false);

        document.addEventListener('mousemove', onMouseMove, false);
    }

    function initializeScene() {
        hasExit = false;
        if(guideLine) { scene.remove(guideLine); guideLine = null; }

        var loader = new THREE.TextureLoader();
        var platformWidth = map[0].length * 100;
        var platformHeight = map.length * 100;

        var floorGeometry = new THREE.BoxGeometry(platformWidth, 5, platformHeight);
        var ground = new THREE.Mesh(floorGeometry, new THREE.MeshPhongMaterial({
            map: loader.load("assets/images/textures/ground_diffuse.jpg"),
        }));

        repeatTexture(ground.material.map, 2);

        ground.position.set(-50, 1, -50);
        scene.add(ground);

        var topMesh = new THREE.Mesh(floorGeometry, new THREE.MeshPhongMaterial({
            map: loader.load("assets/images/textures/roof_diffuse.jpg")
        }));

        repeatTexture(topMesh.material.map, 16);

        topMesh.position.set(-50, 100, -50);
        scene.add(topMesh);

        var size = { x: 100, y: 100, z: 100 };
        var position = { x: 0, y: 0, z: 0 };

        var wallGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        var wallMaterial = new THREE.MeshPhongMaterial({
            map: loader.load("assets/images/textures/wall_diffuse.jpg")
        });
        repeatTexture(wallMaterial.map, 2);

        // --- 透视材质 (X-Ray Material) ---
        // 使用线框模式，颜色设为青蓝色，关闭深度测试(depthTest: false)使其可以透过墙体被看到
        var xrayMaterial = new THREE.MeshBasicMaterial({
            color: 0x0088ff, // 结构光颜色
            wireframe: true,
            depthTest: false, // 关键：允许穿透渲染
            depthWrite: false,
            transparent: true,
            opacity: 0.4
        });

        // Map generation
        for (var y = 0, ly = map.length; y < ly; y++) {
            for (var x = 0, lx = map[x].length; x < lx; x++) {
                position.x = -platformWidth / 2 + size.x * x;
                position.y = 50;
                position.z = -platformHeight / 2 + size.z * y;

                if (x == 0 && y == 0) {
                    cameraHelper.origin.x = position.x;
                    cameraHelper.origin.y = position.y;
                    cameraHelper.origin.z = position.z;
                }

                if (map[y][x] > 1) {
                    // 1. 创建实体墙
                    var wall3D = new THREE.Mesh(wallGeometry, wallMaterial);
                    wall3D.position.set(position.x, position.y, position.z);
                    scene.add(wall3D);

                    // 2. 创建透视结构 (X-Ray Structure)
                    // 在相同位置创建一个线框盒子，作为透视轮廓
                    var xrayMesh = new THREE.Mesh(wallGeometry, xrayMaterial);
                    xrayMesh.position.set(position.x, position.y, position.z);
                    //稍微放大一点点避免Z-fighting(虽然depthTest关了，但放大一点看起来像是包裹着墙)
                    xrayMesh.scale.set(1.01, 1.01, 1.01); 
                    scene.add(xrayMesh);
                }

                if (map[y][x] === "D") {
                    camera.position.set(position.x, position.y, position.z);
                    cameraHelper.origin.position.x = position.x;
                    cameraHelper.origin.position.y = position.y;
                    cameraHelper.origin.position.z = position.z;
                    cameraHelper.origin.position.mapX = x;
                    cameraHelper.origin.position.mapY = y;
                    cameraHelper.origin.position.mapZ = 0;
                }

                if (map[y][x] === "A") {
                    // 记录终点位置用于导航线
                    exitPosition.set(position.x, position.y, position.z);
                    hasExit = true;
                    
                    // 在终点放一个高亮的标记，也具有透视效果
                    var goalGeo = new THREE.BoxGeometry(20, 100, 20);
                    var goalMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, depthWrite: false, transparent: true, opacity: 0.6 });
                    var goalMesh = new THREE.Mesh(goalGeo, goalMat);
                    goalMesh.position.set(position.x, position.y, position.z);
                    scene.add(goalMesh);
                }
            }
        }

        // --- 创建导航线 (Guidance Line) ---
        if (hasExit) {
            var lineGeo = new THREE.Geometry();
            // 起点（玩家），稍后在 update 中更新
            lineGeo.vertices.push(new THREE.Vector3(camera.position.x, camera.position.y - 10, camera.position.z));
            // 终点
            lineGeo.vertices.push(exitPosition);

            var lineMat = new THREE.LineBasicMaterial({
                color: 0xff0000, // 红色导航线
                linewidth: 2,
                depthTest: false, // 关键：穿透墙体
                depthWrite: false,
                transparent: true,
                opacity: 0.8
            });

            guideLine = new THREE.Line(lineGeo, lineMat);
            scene.add(guideLine);
        }

        // Lights
        var directionalLight = new THREE.HemisphereLight(0x192F3F, 0x28343A, 2);
        directionalLight.position.set(1, 1, 0);
        scene.add(directionalLight);

        // 画静态小地图底图
        drawMiniMapStatic();
    }

    // —— 小地图：静态底图（墙/路）
    function drawMiniMapStatic() {
        var mm = $("minimap");
        var obj = $("objects");
        if (!mm || !obj) return;
        var w = map[0].length * mapScale;
        var h = map.length * mapScale;
        mm.width = obj.width = w;
        mm.height = obj.height = h;
        var ctx = mm.getContext("2d");
        ctx.clearRect(0,0,w,h);
        for (var y=0; y<map.length; y++) {
            for (var x=0; x<map[0].length; x++) {
                var v = map[y][x];
                ctx.fillStyle = isWallCellByValue(v) ? "#333" : "#eee";
                ctx.fillRect(x*mapScale, y*mapScale, mapScale, mapScale);
            }
        }
    }

    // —— 轻量 2D 射线（仅用于小地图显示）
    function castRay2D(tx, ty, angle, maxDist) {
        var step = 0.05; // 每步前进的“格”距离
        var dx = Math.cos(angle) * step;
        var dy = Math.sin(angle) * step;
        var dist = 0;
        var x = tx, y = ty;
        while (dist < maxDist) {
            var cx = Math.floor(x), cy = Math.floor(y);
            if (cy < 0 || cy >= map.length || cx < 0 || cx >= map[0].length) break;
            if (isWallCellByValue(map[cy][cx])) break;
            x += dx; y += dy; dist += step;
        }
        return { x: x, y: y };
    }

    // —— 小地图覆盖层（玩家点 + 视野扇形）
    function updateMiniMapOverlay() {
        var mm = $("minimap");
        var obj = $("objects");
        if (!mm || !obj) return;

        var ctx = obj.getContext("2d");
        ctx.clearRect(0, 0, obj.width, obj.height);

        var p = worldToTileFloat(camera.position.x, camera.position.z);
        var px = p.tx, py = p.ty;

        // 玩家点
        ctx.fillStyle = "black";
        ctx.fillRect(px*mapScale - 2, py*mapScale - 2, 4, 4);

        // FOV 射线束
        var fov = 80 * Math.PI / 180;
        var rays = 50;
        var half = fov / 2;
        var base = -camera.rotation.y + Math.PI/2 + Math.PI; // 反向180°

        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 0.5;
        var maxD = Math.max(map.length, map[0].length);

        for (var i=0; i<=rays; i++) {
            var t = i / rays;
            var a = base - half + t * fov;
            var hit = castRay2D(px, py, a, maxD);
            ctx.beginPath();
            ctx.moveTo(px*mapScale, py*mapScale);
            ctx.lineTo(hit.x*mapScale, hit.y*mapScale);
            ctx.stroke();
        }
    }

    function update() {
        // 方向键
        if (input.keys.up) {
            moveCamera("up");
        } else if (input.keys.down) {
            moveCamera("down");
        }
        if (input.keys.left) {
            moveCamera("left");
        } else if (input.keys.right) {
            moveCamera("right");
        }

        // WASD（与方向键并行）
        if (_keys.w) {
            moveCamera("up");
        } else if (_keys.s) {
            moveCamera("down");
        }
        if (_keys.a) {
            moveCamera("left");
        } else if (_keys.d) {
            moveCamera("right");
        }

        // Virtual pad
        var params = {
            rotation: 0.05,
            translation: 5
        };

        if (input.joykeys.up) {
            moveCamera("up", params);
        } else if (input.joykeys.down) {
            moveCamera("down", params);
        }

        if (input.joykeys.left) {
            moveCamera("left", params);
        } else if (input.joykeys.right) {
            moveCamera("right", params);
        }

        // 更新小地图覆盖层
        updateMiniMapOverlay();

        // --- 更新透视导航线 ---
        if (guideLine && hasExit) {
            // 将线的起点设置为相机下方一点点的位置，看起来像是从玩家发出的引导光束
            guideLine.geometry.vertices[0].copy(camera.position);
            guideLine.geometry.vertices[0].y -= 15; // 降低一点，不挡住准心
            guideLine.geometry.verticesNeedUpdate = true;
        }
    }

    function draw() {
        renderer.render(scene, camera);
    }

    function moveCamera(direction, delta) {
        var collides = false;
        var position = {
            x: camera.position.x,
            z: camera.position.z
        };
        var rotation = camera.rotation.y;
        var offset = 75;

        var moveParamaters = {
            translation: (typeof delta != "undefined") ? delta.translation : cameraHelper.translation,
            rotation: (typeof delta != "undefined") ? delta.rotation : cameraHelper.rotation
        };

        switch (direction) {
            case "up":
                position.x -= Math.sin(-camera.rotation.y) * -moveParamaters.translation;
                position.z -= Math.cos(-camera.rotation.y) * moveParamaters.translation;
                break;
            case "down":
                position.x -= Math.sin(camera.rotation.y) * -moveParamaters.translation;
                position.z += Math.cos(camera.rotation.y) * moveParamaters.translation;
                break;
            case "left":
                rotation += moveParamaters.rotation;
                break;
            case "right":
                rotation -= moveParamaters.rotation;
                break;
        }

        // Current position on the map
        var tx = Math.abs(Math.floor(((cameraHelper.origin.x + (camera.position.x * -1)) / 100)));
        var ty = Math.abs(Math.floor(((cameraHelper.origin.z + (camera.position.z * -1)) / 100)));

        // next position
        var newTx = Math.abs(Math.floor(((cameraHelper.origin.x + (position.x * -1) + (offset)) / 100)));
        var newTy = Math.abs(Math.floor(((cameraHelper.origin.z + (position.z * -1) + (offset)) / 100)));

        // Stay on the map
        if (newTx >= map[0].length) newTx = map[0].length;
        if (newTx < 0) newTx = 0;
        if (newTy >= map.length) newTy = map.length;
        if (newTy < 0) newTy = 0;

        if (map[newTy][newTx] != 1 && !isNaN(map[newTy][newTx])) {
            collides = true;
        } else if (map[newTy][newTx] == "A") {
            running = false;
        }

        if (collides == false) {
            camera.rotation.y = rotation;
            camera.position.x = position.x;
            camera.position.z = position.z;
        } else {
            var s = document.getElementById("bumpSound");
            if (s) s.play();
        }
    }

    function mainLoop(time) {
        if (running) {
            update();
            draw();
            window.requestAnimationFrame(mainLoop, renderer.domElement);
        } else {
            endScreen();
        }
    }

    function endScreen() {
        if (levelHelper.isFinished || levelHelper.isMobile) {
            alert("Good job, The game is over\n\nThanks you for playing!");
            // 这里保留原来的跳转或者刷新逻辑
            document.location.reload();
        } else {
            for (var i = 0, l = scene.children.length; i < l; i++) {
                scene.remove(scene.children[i]);
            }
            renderer.clear();
            scene = new THREE.Scene();
            loadLevel(levelHelper.getNext());
            running = true;
        }
    }

    // Level loading
    function loadLevel(level) {
        var ajax = new XMLHttpRequest();
        ajax.open("GET", "assets/maps/maze3d-" + level + ".json", true);
        ajax.onreadystatechange = function() {
            if (ajax.readyState == 4) {
                map = JSON.parse(ajax.responseText);
                launch();
            }
        }
        ajax.send(null);
    }

    function repeatTexture(texture, size) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.x = size;
        texture.repeat.y = size;
        return texture;
    }

    // Game starting
    function launch() {
        initializeScene();
        mainLoop();
    }

    window.onload = function() {
        initializeEngine();

        var level = 1; // Get parameter
        if (level > 0 || level <= levelHelper.count) {
            levelHelper.current = level;
            levelHelper.next = level + 1;
            loadLevel(level);
        } else {
            levelHelper.current = 1;
            levelHelper.next = 2;
            loadLevel(1);
        }
    };
})();