(() => {
  const storageKey = "tspro_v2_tasks";
  const settingsKey = "tspro_v2_settings";

  // DOM elements (same as Phase2)
  const taskForm = document.getElementById("taskForm");
  const taskTitle = document.getElementById("taskTitle");
  const taskNotes = document.getElementById("taskNotes");
  const dueDate = document.getElementById("dueDate");
  const dueTime = document.getElementById("dueTime");
  const tagInput = document.getElementById("tagInput");
  const recurrence = document.getElementById("recurrence");
  const checkpointsDiv = document.getElementById("checkpoints");
  const newCheckpoint = document.getElementById("newCheckpoint");
  const taskList = document.getElementById("taskList");
  const searchInput = document.getElementById("searchInput");
  const filterTag = document.getElementById("filterTag");
  const exportJSON = document.getElementById("exportJSON");
  const importJSONBtn = document.getElementById("importJSONBtn");
  const importJSON = document.getElementById("importJSON");
  const archiveList = document.getElementById("archiveList");
  const toggleTheme = document.getElementById("toggleTheme");
  const formTitle = document.getElementById("formTitle");
  const resetFormBtn = document.getElementById("resetForm");
  const defaultView = document.getElementById("defaultView");
  const sortMode = document.getElementById("sortMode");
  const authBtn = document.getElementById("authBtn");
  const userInfo = document.getElementById("userInfo");
  const syncStatus = document.getElementById("syncStatus");

  // views
  const listView = document.getElementById("listView");
  const calendarView = document.getElementById("calendarView");
  const statsView = document.getElementById("statsView");

  // calendar and stats DOM
  const calendarEl = document.getElementById("calendar");
  const monthLabel = document.getElementById("monthLabel");
  const prevMonth = document.getElementById("prevMonth");
  const nextMonth = document.getElementById("nextMonth");
  const dayTasks = document.getElementById("dayTasks");
  const tasksChart = document.getElementById("tasksChart");
  const statsSummary = document.getElementById("statsSummary");

  // onboarding
  const onboard = document.getElementById("onboard");
  const closeOnboard = document.getElementById("closeOnboard");
  const dontShowOnboard = document.getElementById("dontShowOnboard");

  // state
  let tasks = [];
  let archived = [];
  let editingId = null;
  let settings = {
    theme: "light",
    reminders: true,
    defaultView: "list",
    sortMode: "smart",
    onboardSeen: false,
  };
  let currentMonth = new Date();

  // firebase state
  let firebaseApp = null;
  let firebaseAuth = null;
  let firestore = null;
  let currentUser = null;
  let userDocUnsubscribe = null;
  let saveDebounceTimer = null;

  // util
  const uid = () => "t" + Date.now() + Math.floor(Math.random() * 1000);

  function localSave() {
    localStorage.setItem(storageKey, JSON.stringify({ tasks, archived }));
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }

  // Firestore sync helpers
  function initFirebaseIfAvailable() {
    if (window.firebaseConfig && window.firebase && !firebaseApp) {
      try {
        firebaseApp = firebase.initializeApp(window.firebaseConfig);
        firebaseAuth = firebase.auth();
        firestore = firebase.firestore();
        console.log("Firebase initialized.");
        setupAuth();
      } catch (e) {
        console.warn("Firebase init failed:", e);
      }
    }
  }

  function setupAuth() {
    if (!firebaseAuth) return;
    firebaseAuth.onAuthStateChanged(async (user) => {
      currentUser = user;
      if (user) {
        userInfo.textContent = user.email || user.displayName || user.uid;
        authBtn.textContent = "Sign out";
        syncStatus.textContent = "Syncing...";
        // subscribe to user doc
        subscribeToUserDoc(user.uid);
      } else {
        userInfo.textContent = "";
        authBtn.textContent = "Sign in";
        syncStatus.textContent = "Not signed in";
        // unsubscribe
        if (userDocUnsubscribe) {
          userDocUnsubscribe();
          userDocUnsubscribe = null;
        }
      }
    });
  }

  authBtn.addEventListener("click", async () => {
    // if logged in, sign out; else sign in with Google popup
    if (currentUser && firebaseAuth) {
      await firebaseAuth.signOut();
      return;
    }
    if (!firebaseAuth) {
      alert(
        "Firebase not initialized. Paste your firebaseConfig into index.html and reload."
      );
      return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebaseAuth.signInWithPopup(provider);
    } catch (err) {
      alert("Sign in failed: " + err.message);
    }
  });

  // Subscribe to user's Firestore document and merge remote data into local state.
  function subscribeToUserDoc(uid) {
    if (!firestore) return;
    const docRef = firestore.collection("users").doc(uid);
    // Unsubscribe previous
    if (userDocUnsubscribe) userDocUnsubscribe();
    userDocUnsubscribe = docRef.onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) {
          // If no remote doc, push local to remote
          writeUserDoc();
          syncStatus.textContent = "Synced (created remote)";
          return;
        }
        const remote = snapshot.data() || {};
        // simple merge strategy: prefer remote if remote.lastUpdated > localLastUpdated
        const remoteUpdated = remote.lastUpdated
          ? remote.lastUpdated.toMillis
            ? remote.lastUpdated.toMillis()
            : remote.lastUpdated
          : 0;
        const localRaw = localStorage.getItem(storageKey);
        const localUpdatedRaw = localStorage.getItem(settingsKey);
        const localUpdated = localUpdatedRaw
          ? JSON.parse(localUpdatedRaw).lastUpdated || 0
          : 0;
        if (remoteUpdated && remoteUpdated > localUpdated) {
          // apply remote
          tasks = remote.tasks || [];
          archived = remote.archived || [];
          settings = Object.assign(settings, remote.settings || {});
          settings.lastUpdated = remoteUpdated;
          localSave();
          render();
          syncStatus.textContent = "Synced (remote newer)";
        } else {
          // push local to remote
          writeUserDoc();
          syncStatus.textContent = "Synced (local newer)";
        }
      },
      (err) => {
        console.warn("User doc snapshot error", err);
        syncStatus.textContent = "Sync error";
      }
    );
  }

  // write user doc with debounce to avoid rapid writes
  function writeUserDoc() {
    if (!firestore || !currentUser) return;
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      const docRef = firestore.collection("users").doc(currentUser.uid);
      const payload = {
        tasks: tasks,
        archived: archived,
        settings: settings,
        lastUpdated: firebase.firestore.Timestamp.fromDate(new Date()),
      };
      try {
        await docRef.set(payload, { merge: true });
        syncStatus.textContent = "Synced";
      } catch (err) {
        console.warn("Failed to write user doc:", err);
        syncStatus.textContent = "Sync error";
      }
    }, 800);
  }

  // load from localStorage and init firebase
  function loadAll() {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        tasks = parsed.tasks || [];
        archived = parsed.archived || [];
      } catch (e) {}
    }
    const s = localStorage.getItem(settingsKey);
    if (s) {
      try {
        const parsedS = JSON.parse(s);
        settings = Object.assign(settings, parsedS);
      } catch (e) {}
    }
    applyTheme();
    if (settings.defaultView) defaultView.value = settings.defaultView;
    if (settings.sortMode) sortMode.value = settings.sortMode;
    initFirebaseIfAvailable();
  }

  // theme
  function applyTheme() {
    if (settings.theme === "dark")
      document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    // also persist a lastUpdated timestamp in settings for merge checks
    settings.lastUpdated = settings.lastUpdated || Date.now();
    localSave();
  }
  toggleTheme.addEventListener("click", () => {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    settings.lastUpdated = Date.now();
    applyTheme();
    if (currentUser) writeUserDoc();
  });

  // Notifications (unchanged)
  function requestNotifyPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();
  }
  requestNotifyPermission();

  function scheduleNotificationsForTask(t) {
    if (!settings.reminders) return;
    if (!t.due) return;
    try {
      const dueMs = new Date(t.due).getTime();
      const remindBefore = (t.remindBeforeMinutes || 2880) * 60 * 1000; // default 2 days
      const when = dueMs - remindBefore;
      const now = Date.now();
      if (when > now) {
        setTimeout(() => {
          if (Notification.permission === "granted") {
            new Notification("Reminder: " + t.title, {
              body: t.notes || "Task due soon",
              tag: t.id,
            });
          }
        }, when - now);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // render tags filter
  function refreshTagFilter() {
    const tagSet = new Set();
    tasks.forEach((t) => (t.tags || []).forEach((tag) => tagSet.add(tag)));
    filterTag.innerHTML = '<option value="">All tags</option>';
    Array.from(tagSet).forEach((tag) => {
      const o = document.createElement("option");
      o.value = tag;
      o.textContent = tag;
      filterTag.appendChild(o);
    });
  }

  // checkpoints UI
  function renderCheckpoints(task) {
    checkpointsDiv.innerHTML = "";
    const cps = (task && task.checkpoints) || [];
    cps.forEach((cp, idx) => {
      const div = document.createElement("div");
      div.className = "checkpoint";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!cp.done;
      const label = document.createElement("span");
      label.textContent = cp.text;
      const del = document.createElement("button");
      del.textContent = "✕";
      del.className = "icon";
      del.addEventListener("click", () => {
        cps.splice(idx, 1);
        renderCheckpoints({ checkpoints: cps });
        if (task) task.checkpoints = cps;
      });
      cb.addEventListener("change", () => {
        cp.done = cb.checked;
        if (task) {
          task.checkpoints = cps;
          if (cps.length > 0 && cps.every((x) => x.done)) {
            task.status = "done";
          }
          settings.lastUpdated = Date.now();
          localSave();
          if (currentUser) writeUserDoc();
          render();
        }
      });
      div.appendChild(cb);
      div.appendChild(label);
      div.appendChild(del);
      checkpointsDiv.appendChild(div);
    });
  }

  newCheckpoint.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && newCheckpoint.value.trim()) {
      const text = newCheckpoint.value.trim();
      let cps = [];
      if (editingId) {
        const t = tasks.find((x) => x.id === editingId);
        if (t) cps = t.checkpoints || [];
      }
      cps.push({ text, done: false });
      newCheckpoint.value = "";
      renderCheckpoints({ checkpoints: cps });
      if (editingId) {
        const t = tasks.find((x) => x.id === editingId);
        if (t) t.checkpoints = cps;
      } else {
        taskForm.dataset.tempCheckpoints = JSON.stringify(cps);
      }
    }
  });

  // add/save task
  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = taskTitle.value.trim();
    if (!title) return alert("Title required");
    const notes = taskNotes.value.trim();
    const tags = (tagInput.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const dDate = dueDate.value ? dueDate.value : null;
    const dTime = dueTime.value ? dueTime.value : null;
    let due = null;
    if (dDate) {
      due = dTime ? new Date(dDate + "T" + dTime) : new Date(dDate + "T00:00");
      due = due.toISOString();
    }
    const remBefore = 2880; // default 2 days in minutes
    const cps = taskForm.dataset.tempCheckpoints
      ? JSON.parse(taskForm.dataset.tempCheckpoints)
      : [];
    const recur = recurrence.value || "";
    if (editingId) {
      const t = tasks.find((x) => x.id === editingId);
      if (t) {
        t.title = title;
        t.notes = notes;
        t.tags = tags;
        t.due = due;
        t.checkpoints = cps;
        t.recurrence = recur;
        t.remindBeforeMinutes = remBefore;
        t.updatedAt = new Date().toISOString();
      }
    } else {
      const t = {
        id: uid(),
        title,
        notes,
        tags,
        due,
        checkpoints: cps,
        created: new Date().toISOString(),
        status: "todo",
        recurrence: recur,
        remindBeforeMinutes: remBefore,
      };
      tasks.push(t);
      scheduleNotificationsForTask(t);
    }
    // reset
    editingId = null;
    taskForm.dataset.tempCheckpoints = "[]";
    resetForm();
    settings.lastUpdated = Date.now();
    localSave();
    if (currentUser) writeUserDoc();
    render();
  });

  function resetForm() {
    taskTitle.value = "";
    taskNotes.value = "";
    tagInput.value = "";
    dueDate.value = "";
    dueTime.value = "";
    recurrence.value = "";
    newCheckpoint.value = "";
    checkpointsDiv.innerHTML = "";
    formTitle.textContent = "Add Task";
    editingId = null;
  }
  resetFormBtn.addEventListener("click", resetForm);

  // smart sort
  function smartSort(arr) {
    return arr.sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (b.status === "done" && a.status !== "done") return -1;
      const aDue = a.due ? new Date(a.due).getTime() : Infinity;
      const bDue = b.due ? new Date(b.due).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      const aPending = (a.checkpoints || []).filter((c) => !c.done).length;
      const bPending = (b.checkpoints || []).filter((c) => !c.done).length;
      return bPending - aPending;
    });
  }

  // render tasks
  function render() {
    taskList.innerHTML = "";
    const q = (searchInput.value || "").toLowerCase();
    const tagFilter = filterTag.value;
    let visible = tasks.filter((t) => {
      if (tagFilter && !(t.tags || []).includes(tagFilter)) return false;
      if (q) {
        return (
          t.title.toLowerCase().includes(q) ||
          (t.notes || "").toLowerCase().includes(q) ||
          (t.tags || []).join(" ").toLowerCase().includes(q)
        );
      }
      return true;
    });

    if (sortMode.value === "smart") visible = smartSort(visible);
    else if (sortMode.value === "due")
      visible = visible.sort((a, b) => {
        if (a.due && b.due) return new Date(a.due) - new Date(b.due);
        if (a.due) return -1;
        if (b.due) return 1;
        return 0;
      });
    else if (sortMode.value === "created")
      visible = visible.sort(
        (a, b) => new Date(a.created) - new Date(b.created)
      );

    visible.forEach((t) => {
      const el = document.createElement("div");
      el.className = "task";
      const left = document.createElement("div");
      const title = document.createElement("div");
      title.innerHTML = `<strong>${t.title}</strong>`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML =
        (t.due ? `Due: ${new Date(t.due).toLocaleString()}` : "") +
        (t.recurrence ? " • " + t.recurrence : "");
      const tags = document.createElement("div");
      (t.tags || []).forEach((tag) => {
        const s = document.createElement("span");
        s.className = "tag";
        s.textContent = tag;
        tags.appendChild(s);
      });
      left.appendChild(title);
      left.appendChild(meta);
      left.appendChild(tags);
      if (t.checkpoints && t.checkpoints.length > 0) {
        const cpDiv = document.createElement("div");
        cpDiv.innerHTML = `${t.checkpoints.filter((c) => c.done).length}/${
          t.checkpoints.length
        } checkpoints`;
        left.appendChild(cpDiv);
      }
      el.appendChild(left);
      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "4px";
      const editBtn = document.createElement("button");
      editBtn.textContent = "✏️";
      editBtn.className = "icon";
      const doneBtn = document.createElement("button");
      doneBtn.textContent = t.status === "done" ? "↶" : "✓";
      doneBtn.className = "icon";
      const archiveBtn = document.createElement("button");
      archiveBtn.textContent = "📁";
      archiveBtn.className = "icon";
      editBtn.addEventListener("click", () => {
        editingId = t.id;
        taskTitle.value = t.title;
        taskNotes.value = t.notes || "";
        tagInput.value = (t.tags || []).join(", ");
        if (t.due) {
          const d = new Date(t.due);
          dueDate.value = d.toISOString().split("T")[0];
          dueTime.value =
            d.toTimeString().split(":")[0] +
            ":" +
            d.toTimeString().split(":")[1];
        } else {
          dueDate.value = "";
          dueTime.value = "";
        }
        recurrence.value = t.recurrence || "";
        renderCheckpoints(t);
        formTitle.textContent = "Edit Task";
      });
      doneBtn.addEventListener("click", () => {
        if (t.status === "done") {
          t.status = "todo";
          t.completedAt = null;
        } else {
          t.status = "done";
          t.completedAt = new Date().toISOString();
          if (t.recurrence) {
            // create next recurrence
            const next = {
              ...t,
              id: uid(),
              status: "todo",
              created: new Date().toISOString(),
              completedAt: null,
              checkpoints: (t.checkpoints || []).map((cp) => ({
                ...cp,
                done: false,
              })),
            };
            let nextDate = new Date();
            if (t.due) nextDate = new Date(t.due);
            if (t.recurrence === "daily")
              nextDate.setDate(nextDate.getDate() + 1);
            else if (t.recurrence === "weekly")
              nextDate.setDate(nextDate.getDate() + 7);
            else if (t.recurrence === "monthly")
              nextDate.setMonth(nextDate.getMonth() + 1);
            next.due = nextDate.toISOString();
            tasks.push(next);
          }
        }
        settings.lastUpdated = Date.now();
        localSave();
        if (currentUser) writeUserDoc();
        render();
      });
      archiveBtn.addEventListener("click", () => {
        archived.push(t);
        tasks = tasks.filter((x) => x.id !== t.id);
        settings.lastUpdated = Date.now();
        localSave();
        if (currentUser) writeUserDoc();
        render();
      });
      right.appendChild(editBtn);
      right.appendChild(doneBtn);
      right.appendChild(archiveBtn);
      el.appendChild(right);
      if (t.status === "done") el.style.opacity = "0.7";
      taskList.appendChild(el);
    });
    // archive
    archiveList.innerHTML = "";
    archived.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t.title;
      const restoreBtn = document.createElement("button");
      restoreBtn.textContent = "↶";
      restoreBtn.className = "icon";
      restoreBtn.addEventListener("click", () => {
        tasks.push(t);
        archived = archived.filter((x) => x.id !== t.id);
        settings.lastUpdated = Date.now();
        localSave();
        if (currentUser) writeUserDoc();
        render();
      });
      li.appendChild(restoreBtn);
      archiveList.appendChild(li);
    });
    refreshTagFilter();
  }

  // export/import
  exportJSON.addEventListener("click", () => {
    const data = JSON.stringify(
      { tasks, archived, exportedAt: new Date().toISOString() },
      null,
      2
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "taskschedule-pro-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });

  importJSONBtn.addEventListener("click", () => importJSON.click());
  importJSON.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.tasks) tasks = data.tasks;
        if (data.archived) archived = data.archived;
        settings.lastUpdated = Date.now();
        localSave();
        if (currentUser) writeUserDoc();
        render();
      } catch (err) {
        alert("Invalid JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  });

  // search and filter
  searchInput.addEventListener("input", render);
  filterTag.addEventListener("change", render);
  sortMode.addEventListener("change", () => {
    settings.sortMode = sortMode.value;
    settings.lastUpdated = Date.now();
    localSave();
    if (currentUser) writeUserDoc();
    render();
  });

  // view switching
  defaultView.addEventListener("change", () => {
    settings.defaultView = defaultView.value;
    settings.lastUpdated = Date.now();
    localSave();
    if (currentUser) writeUserDoc();
    showView(settings.defaultView);
  });

  function showView(name) {
    listView.style.display = name === "list" ? "block" : "none";
    calendarView.style.display = name === "calendar" ? "block" : "none";
    statsView.style.display = name === "stats" ? "block" : "none";
    if (name === "calendar") renderCalendar();
    if (name === "stats") renderStats();
  }

  // calendar view
  function renderCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    monthLabel.textContent = new Date(year, month).toLocaleDateString(
      undefined,
      { month: "long", year: "numeric" }
    );
    calendarEl.innerHTML = "";
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDay = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
    // create empty cells for days before first day of month
    for (let i = 0; i < startDay; i++) {
      const cell = document.createElement("div");
      cell.className = "calendar-day empty";
      calendarEl.appendChild(cell);
    }
    // create cells for each day
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.className = "calendar-day";
      const dayNum = document.createElement("div");
      dayNum.className = "day-num";
      dayNum.textContent = day;
      cell.appendChild(dayNum);
      const dateStr = new Date(year, month, day).toISOString().split("T")[0];
      const dayTasks = tasks.filter((t) => t.due && t.due.startsWith(dateStr));
      if (dayTasks.length > 0) {
        const tasksEl = document.createElement("div");
        tasksEl.className = "day-tasks";
        dayTasks.forEach((t) => {
          const taskDot = document.createElement("span");
          taskDot.className = "task-dot";
          const taskTitle = document.createElement("span");
          taskTitle.textContent = t.title;
          tasksEl.appendChild(taskDot);
          tasksEl.appendChild(taskTitle);
        });
        cell.appendChild(tasksEl);
      }
      calendarEl.appendChild(cell);
    }
  }

  prevMonth.addEventListener("click", () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    renderCalendar();
  });
  nextMonth.addEventListener("click", () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    renderCalendar();
  });

  // stats view
  function renderStats() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const pending = total - done;
    const withCheckpoints = tasks.filter(
      (t) => t.checkpoints && t.checkpoints.length > 0
    ).length;
    const overdue = tasks.filter(
      (t) => t.due && new Date(t.due) < new Date() && t.status !== "done"
    ).length;
    statsSummary.innerHTML = `
              <div>Total tasks: ${total}</div>
              <div>Done: ${done}</div>
              <div>Pending: ${pending}</div>
              <div>With checkpoints: ${withCheckpoints}</div>
              <div>Overdue: ${overdue}</div>
          `;
    // simple bar chart using divs
    tasksChart.innerHTML = "";
    const chartData = [total, done, pending, withCheckpoints, overdue];
    const labels = ["Total", "Done", "Pending", "With CPs", "Overdue"];
    const max = Math.max(...chartData);
    chartData.forEach((val, idx) => {
      const bar = document.createElement("div");
      bar.style.display = "flex";
      bar.style.alignItems = "center";
      bar.style.marginBottom = "8px";
      const label = document.createElement("div");
      label.textContent = labels[idx];
      label.style.width = "80px";
      const barInner = document.createElement("div");
      barInner.style.height = "20px";
      barInner.style.backgroundColor = "var(--accent)";
      barInner.style.width = (val / max) * 100 + "%";
      barInner.style.borderRadius = "4px";
      const count = document.createElement("div");
      count.textContent = val;
      count.style.marginLeft = "8px";
      bar.appendChild(label);
      bar.appendChild(barInner);
      bar.appendChild(count);
      tasksChart.appendChild(bar);
    });
  }

  // onboarding
  closeOnboard.addEventListener("click", () => {
    onboard.style.display = "none";
    settings.onboardSeen = true;
    if (dontShowOnboard.checked) settings.dontShowOnboard = true;
    settings.lastUpdated = Date.now();
    localSave();
    if (currentUser) writeUserDoc();
  });

  // init
  loadAll();
  render();
  showView(settings.defaultView);
  if (!settings.onboardSeen && !settings.dontShowOnboard)
    onboard.style.display = "flex";
})();
