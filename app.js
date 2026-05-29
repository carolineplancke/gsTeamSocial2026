 const LS_SCANS = "scans";

  let PEOPLE = {};
  let scanner;
  let isScanning = false;

  // ✅ LOAD PEOPLE
  async function loadPeople() {
    const res = await fetch("people.json");
    const data = await res.json();

    data.forEach(p => {
      if (!p || !p.id) return;
      PEOPLE[p.id] = { name: p.name, title: p.jobTitle };
    });
  }

  // ✅ INIT
  (async function init() {
    await loadPeople();
    document.getElementById("status").innerText = "Ready to scan ✅";
  })();

  // ✅ IMAGE LOADER
  function setImageSource(img, uid) {
    const formats = ["jpg", "jpeg", "png", "JPG"];
    let i = 0;

    function tryNext() {
      if (i >= formats.length) return;
      img.src = `images/${uid}.${formats[i++]}`;
    }

    img.onerror = tryNext;
    tryNext();
  }

  // ✅ NAV
  function showScreen(s) {
    document.getElementById("scanScreen").classList.toggle("active", s === "scan");
    document.getElementById("historyScreen").classList.toggle("active", s === "history");
    document.getElementById("leaderboardScreen").classList.toggle("active", s === "leaderboard");

    if (s === "history") loadHistory();
    if (s === "leaderboard") loadLeaderboard();
  }

  // ✅ TOAST
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg;
    t.style.display = "block";
    setTimeout(() => { t.style.display = "none"; }, 2000);
  }

  // ✅ SCANNER
  async function startScanner(mode) {
    if (isScanning) return;

    isScanning = true;
    document.getElementById("scanOverlay").style.display = "flex";

    if (scanner) {
      try { await scanner.stop(); } catch (e) {}
      try { scanner.clear(); } catch (e) {}
    }

    scanner = new Html5Qrcode("reader");

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10 },
        (text) => {
          if (!isScanning) return;
          isScanning = false;

          handleScan(text, mode);
          closeScanner();
        }
      );
    } catch (e) {
      console.error(e);
      showToast("Camera error — check permissions");
      closeScanner();
    }
  }

  async function closeScanner() {
    try {
      if (scanner) {
        await scanner.stop();
        await scanner.clear();
      }
    } catch (e) {}

    document.getElementById("scanOverlay").style.display = "none";
    isScanning = false;
  }

  // ✅ SCAN LOGIC + FIREBASE
  function handleScan(text, mode) {
    const id = (text || "").trim();
    if (!id) return;

    const person = PEOPLE[id];
    const user = window.currentUid;

    if (!user) {
      showToast("Still connecting… try again");
      return;
    }

    // ✅ SCAN YOUR BADGE = LINK UID TO REAL PERSON
    if (mode === "signin") {
      if (window.db && window.setDoc && window.doc) {
        window.setDoc(window.doc(window.db, "users", user), {
          personId: id
        }).then(() => {
          showToast(`👋 You are now ${person?.name || id}`);
          document.getElementById("status").innerText =
            `Signed in as ${person?.name || id}`;
        }).catch(err => {
          console.error(err);
          showToast("Could not save badge identity");
        });
      }
      return;
    }

    // ✅ NORMAL TEAMMATE SCAN
    let scans = JSON.parse(localStorage.getItem(LS_SCANS)) || [];
    const exists = scans.some(s => s.from === user && s.to === id);

    if (!exists) {
      scans.push({ from: user, to: id });
      localStorage.setItem(LS_SCANS, JSON.stringify(scans));

      if (window.db && window.addDoc && window.collection) {
        window.addDoc(window.collection(window.db, "scans"), {
          scannerUid: user,
          scannedPersonId: id,
          timestamp: Date.now()
        }).then(() => {
          console.log("✅ Firebase saved");
        }).catch(err => {
          console.warn("Firebase error", err);
        });
      }
    }

    showToast(person ? `✅ +1 ${person.name}` : `✅ Saved`);
  }

  // ✅ HISTORY
  function loadHistory() {
    const list = document.getElementById("historyList");
    list.innerHTML = "";

    const user = window.currentUid;
    if (!user) {
      list.innerHTML = "Still connecting...";
      return;
    }

    const scans = JSON.parse(localStorage.getItem(LS_SCANS)) || [];

    scans.filter(s => s.from === user).forEach(s => {
      const row = document.createElement("div");
      row.className = "historyItem";

      const img = document.createElement("img");
      img.className = "avatar";
      setImageSource(img, s.to);

      const p = PEOPLE[s.to] || {};

      const text = document.createElement("div");
      text.innerHTML = `
        <strong>${p.name || s.to}</strong><br>
        <small>${p.title || ""}</small>
      `;

      row.appendChild(img);
      row.appendChild(text);
      list.appendChild(row);
    });
  }

  // ✅ RESET
  function resetUser() {
    localStorage.clear();
    location.reload();
  }

  // ✅ LEADERBOARD
  async function loadLeaderboard() {
    if (!window.db) {
      console.warn("No Firebase connection");
      document.getElementById("topConnectors").innerHTML = "Firebase not available";
      document.getElementById("mostPopular").innerHTML = "Firebase not available";
      return;
    }

    const containerA = document.getElementById("topConnectors");
    const containerB = document.getElementById("mostPopular");

    containerA.innerHTML = "Loading...";
    containerB.innerHTML = "Loading...";

    try {
      const { scans, userMap } = await fetchFirestoreData();

      const outgoing = {};
      const incoming = {};

      scans.forEach(data => {
        const scannerPersonId = userMap[data.scannerUid] || data.scannerUid;

        outgoing[scannerPersonId] = (outgoing[scannerPersonId] || 0) + 1;
        incoming[data.scannedPersonId] = (incoming[data.scannedPersonId] || 0) + 1;
      });

      const sortedOutgoing = Object.entries(outgoing)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const sortedIncoming = Object.entries(incoming)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      renderLeaderboard(containerA, sortedOutgoing);
      renderLeaderboard(containerB, sortedIncoming);

    } catch (e) {
      console.error(e);
      containerA.innerHTML = "Error loading";
      containerB.innerHTML = "Error loading";
    }
  }

  async function fetchFirestoreData() {
    const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    const scansSnapshot = await getDocs(collection(window.db, "scans"));
    const scans = scansSnapshot.docs.map(d => d.data());

    const usersSnapshot = await getDocs(collection(window.db, "users"));
    const userMap = {};

    usersSnapshot.forEach(d => {
      const data = d.data();
      userMap[d.id] = data.personId;
    });

    return { scans, userMap };
  }

  function renderLeaderboard(container, data) {
    container.innerHTML = "";

    data.forEach(([uid, count], i) => {
      const p = PEOPLE[uid] || {};

      const row = document.createElement("div");
      row.className = "historyItem";

      const img = document.createElement("img");
      img.className = "avatar";
      setImageSource(img, uid);

      const text = document.createElement("div");
      text.innerHTML = `
        <strong>${i + 1}. ${p.name || uid}</strong><br>
        <small>${count} scans</small>
      `;

      row.appendChild(img);
      row.appendChild(text);
      container.appendChild(row);
    });
  }
