const firebaseConfig = window.TAW_FIREBASE_CONFIG || {};
const databaseURL = firebaseConfig.databaseURL?.replace(/\/$/, "");
let lastDatabaseJson = "";
let pollTimer = null;

const state = {
  data: null,
  view: "overview",
  peopleType: "ADMIN",
  selectedPersonKey: "",
  selectedClassroomKey: "",
  selectedMarketingAdminKey: "",
  selectedMarketingKey: "",
  treePath: "",
  attendanceRecords: {},
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  connectionDot: $("#connectionDot"),
  connectionText: $("#connectionText"),
  statsGrid: $("#statsGrid"),
  rootNodeList: $("#rootNodeList"),
  globalSearch: $("#globalSearch"),
  searchResults: $("#searchResults"),
  searchCount: $("#searchCount"),
  peopleSearch: $("#peopleSearch"),
  peopleList: $("#peopleList"),
  personForm: $("#personForm"),
  personEditorTitle: $("#personEditorTitle"),
  deletePersonBtn: $("#deletePersonBtn"),
  classroomSearch: $("#classroomSearch"),
  classroomList: $("#classroomList"),
  classroomForm: $("#classroomForm"),
  classroomEditorTitle: $("#classroomEditorTitle"),
  deleteClassroomBtn: $("#deleteClassroomBtn"),
  marketingAdmin: $("#marketingAdmin"),
  marketingList: $("#marketingList"),
  marketingForm: $("#marketingForm"),
  marketingEditorTitle: $("#marketingEditorTitle"),
  deleteMarketingBtn: $("#deleteMarketingBtn"),
  personRelations: $("#personRelations"),
  classroomRelations: $("#classroomRelations"),
  attendanceDate: $("#attendanceDate"),
  attendanceAdmin: $("#attendanceAdmin"),
  attendanceClassroom: $("#attendanceClassroom"),
  attendanceList: $("#attendanceList"),
  relationshipSearch: $("#relationshipSearch"),
  healthCount: $("#healthCount"),
  healthList: $("#healthList"),
  relationshipCount: $("#relationshipCount"),
  relationshipList: $("#relationshipList"),
  treeFilter: $("#treeFilter"),
  breadcrumb: $("#breadcrumb"),
  treeChildren: $("#treeChildren"),
  treeEditor: $("#treeEditor"),
  treeEditorTitle: $("#treeEditorTitle"),
  treeNodeMeta: $("#treeNodeMeta"),
  childDialog: $("#childDialog"),
  childKeyInput: $("#childKeyInput"),
  childValueInput: $("#childValueInput"),
};

const personFields = {
  ADMIN: [
    "FULL_NAME",
    "EMAIL",
    "PASSWORD",
    "TEL",
    "APPROVAL",
    "SUBJECTS",
    "LEVELS",
    "FEES",
    "STUDENTS",
    "VIRTUAL_ROOMS",
    "VR_LINK",
    "WHITEBOARD",
    "BIO",
    "REASON",
    "PROFILE_LINK",
    "WALLPAPER",
  ],
  STUDENTS: [
    "FULL_NAME",
    "EMAIL",
    "PASSWORD",
    "TEL",
    "R_PARTY",
    "R_PARTY_TEL",
    "VIRTUAL_ROOMS",
  ],
};

const classroomFields = [
  "CLASSROOM_ID",
  "TITLE",
  "STORAGE_FOLDER",
  "TEACHER_FULL_NAME",
  "TEACHER_TEL",
  "TEACHER_ADDRESS",
  "VR_LINK",
];

window.addEventListener("unhandledrejection", (event) => {
  showAlert(event.reason?.message || String(event.reason), "error");
});

window.addEventListener("error", (event) => {
  showAlert(event.message, "error");
});

function cleanPath(path = "") {
  return String(path).split("/").filter(Boolean).join("/");
}

function databaseUrl(path = "") {
  if (!databaseURL) {
    throw new Error("Missing databaseURL in firebase-config.js.");
  }
  const normalized = cleanPath(path)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${databaseURL}/${normalized}.json`;
}

async function firebaseRequest(path = "", options = {}) {
  const response = await fetch(databaseUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firebase ${options.method || "GET"} failed at /${cleanPath(path)}: ${response.status} ${body}`);
  }

  return response;
}

async function dbGet(path = "", options = {}) {
  const response = await firebaseRequest(path, {
    method: "GET",
    headers: options.headers || {},
  });
  const text = await response.text();
  if (!text || text.trim() === "null") return null;
  const value = JSON.parse(text);
  return options.withResponse ? { value, response } : value;
}

async function dbSet(path, value, headers = {}) {
  await firebaseRequest(path, {
    method: "PUT",
    headers,
    body: JSON.stringify(value),
  });
}

async function dbUpdate(path, value) {
  await firebaseRequest(path, {
    method: "PATCH",
    body: JSON.stringify(value),
  });
}

async function dbRemove(path) {
  await firebaseRequest(path, { method: "DELETE" });
}

async function dbTransaction(path, updater, maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { value, response } = await dbGet(path, {
      headers: { "X-Firebase-ETag": "true" },
      withResponse: true,
    });
    const etag = response.headers.get("etag") || "*";
    const nextValue = updater(value);
    try {
      await dbSet(path, nextValue, { "if-match": etag });
      return nextValue;
    } catch (error) {
      if (String(error.message).includes("412")) continue;
      throw error;
    }
  }
  throw new Error(`Could not update /${cleanPath(path)} after ${maxAttempts} attempts.`);
}

function pathParts(path = "") {
  return cleanPath(path).split("/").filter(Boolean);
}

function getAtPath(source, path = "") {
  return pathParts(path).reduce((node, part) => (node == null ? undefined : node[part]), source);
}

function childPath(base, child) {
  return cleanPath(`${cleanPath(base)}/${child}`);
}

function objectEntries(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeJson(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function parseEditorJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

function showAlert(message, type = "success") {
  const alert = document.createElement("div");
  alert.className = `alert ${type}`;
  alert.textContent = message;
  $("#alertHost").append(alert);
  setTimeout(() => alert.remove(), 4200);
}

function labelForKey(key, value) {
  if (isObject(value)) {
    return value.FULL_NAME || value.TITLE || value.EMAIL || value.STUDENT_NAME || value.CLASSROOM_TITLE || key;
  }
  return key;
}

function summaryFor(value) {
  if (Array.isArray(value)) return `${value.filter((item) => item !== null).length} list items`;
  if (isObject(value)) return `${Object.keys(value).length} child nodes`;
  if (value === null || value === undefined) return "empty";
  return String(value).slice(0, 100);
}

function recordLabel(type, key) {
  if (type === "ADMIN") {
    const admin = getAtPath(state.data, `ADMIN/${key}`);
    return admin ? `${key} - ${admin.FULL_NAME || admin.EMAIL || ""}` : key;
  }
  if (type === "STUDENTS") {
    const student = getAtPath(state.data, `STUDENTS/${key}`);
    return student ? `${key} - ${student.FULL_NAME || student.EMAIL || ""}` : key;
  }
  if (type === "CLASSROOMS") {
    const classroom = getAtPath(state.data, `CLASSROOMS/${key}`);
    return classroom ? `${classroom.CLASSROOM_ID || key} - ${classroom.TITLE || ""}` : key;
  }
  return key;
}

function classroomKeyById(classroomId) {
  const id = String(classroomId);
  return classroomRecords().find(([, classroom]) => String(classroom?.CLASSROOM_ID) === id)?.[0] || "";
}

function buildRelationshipGraph() {
  const data = state.data || {};
  const admins = Object.fromEntries(objectEntries(data.ADMIN));
  const students = Object.fromEntries(objectEntries(data.STUDENTS));
  const classrooms = Object.fromEntries(objectEntries(data.CLASSROOMS));
  const graph = {
    adminStudents: {},
    adminClassrooms: {},
    studentAdmins: {},
    studentClassrooms: {},
    classroomAdmins: {},
    classroomStudents: {},
    classroomAssets: {},
    feedbackByStudent: {},
    feedbackByTutor: {},
    attendanceByStudent: {},
    missing: [],
    unassignedStudents: [],
    studentsWithoutAdmin: [],
    classroomsWithoutStudents: [],
    classroomsWithoutAdmin: [],
    assetNodesWithoutClassroom: [],
  };

  for (const [adminKey, admin] of Object.entries(admins)) {
    graph.adminStudents[adminKey] = csvIds(admin.STUDENTS);
    graph.adminClassrooms[adminKey] = csvIds(admin.VIRTUAL_ROOMS);

    graph.adminStudents[adminKey].forEach((studentKey) => {
      if (!students[studentKey]) {
        graph.missing.push({
          type: "Missing student",
          message: `${adminKey} references ${studentKey}, but that student node does not exist.`,
          path: `ADMIN/${adminKey}/STUDENTS`,
          severity: "danger",
        });
        return;
      }
      graph.studentAdmins[studentKey] ||= [];
      graph.studentAdmins[studentKey].push(adminKey);
    });

    graph.adminClassrooms[adminKey].forEach((classroomId) => {
      const classroomKey = classroomKeyById(classroomId);
      if (!classroomKey) {
        graph.missing.push({
          type: "Missing classroom",
          message: `${adminKey} references classroom ${classroomId}, but that classroom node does not exist.`,
          path: `ADMIN/${adminKey}/VIRTUAL_ROOMS`,
          severity: "danger",
        });
        return;
      }
      graph.classroomAdmins[classroomKey] ||= [];
      graph.classroomAdmins[classroomKey].push(adminKey);
    });
  }

  for (const [studentKey, student] of Object.entries(students)) {
    graph.studentClassrooms[studentKey] = csvIds(student.VIRTUAL_ROOMS);
    if (graph.studentClassrooms[studentKey].length === 0) graph.unassignedStudents.push(studentKey);
    if (!graph.studentAdmins[studentKey]?.length) graph.studentsWithoutAdmin.push(studentKey);

    graph.studentClassrooms[studentKey].forEach((classroomId) => {
      const classroomKey = classroomKeyById(classroomId);
      if (!classroomKey) {
        graph.missing.push({
          type: "Missing classroom",
          message: `${studentKey} is assigned to classroom ${classroomId}, but that classroom node does not exist.`,
          path: `STUDENTS/${studentKey}/VIRTUAL_ROOMS`,
          severity: "danger",
        });
        return;
      }
      graph.classroomStudents[classroomKey] ||= [];
      graph.classroomStudents[classroomKey].push(studentKey);
    });
  }

  for (const [classroomKey, classroom] of Object.entries(classrooms)) {
    const id = String(classroom.CLASSROOM_ID || classroomKey.replace(/\D/g, ""));
    graph.classroomAssets[classroomKey] = {
      notesPath: data[`${id}_NOTES`] ? `${id}_NOTES` : "",
      homeworkPath: data[`${id}_HOMEWORK`] ? `${id}_HOMEWORK` : "",
      noteCount: countNodeItems(data[`${id}_NOTES`]),
      homeworkCount: countNodeItems(data[`${id}_HOMEWORK`]),
    };
    if (!graph.classroomStudents[classroomKey]?.length) graph.classroomsWithoutStudents.push(classroomKey);
    if (!graph.classroomAdmins[classroomKey]?.length) graph.classroomsWithoutAdmin.push(classroomKey);
  }

  for (const [rootKey, value] of objectEntries(data)) {
    const match = rootKey.match(/^(\d+)_(NOTES|HOMEWORK)$/);
    if (!match) continue;
    if (!classroomKeyById(match[1])) {
      graph.assetNodesWithoutClassroom.push(rootKey);
    }
  }

  for (const [feedbackKey, feedback] of objectEntries(data.FEEDBACK)) {
    if (feedback?.STUDENT_KEY) {
      graph.feedbackByStudent[feedback.STUDENT_KEY] ||= [];
      graph.feedbackByStudent[feedback.STUDENT_KEY].push(feedbackKey);
    }
    if (feedback?.TUTOR_KEY) {
      graph.feedbackByTutor[feedback.TUTOR_KEY] ||= [];
      graph.feedbackByTutor[feedback.TUTOR_KEY].push(feedbackKey);
    }
  }

  walk(data.ATTENDANCE || {}, "ATTENDANCE", (path, value) => {
    const parts = pathParts(path);
    const last = parts.at(-1);
    if (!last || !/^STUDENTS_/.test(last) || !isObject(value)) return;
    graph.attendanceByStudent[last] ||= [];
    graph.attendanceByStudent[last].push(path);
  });

  return graph;
}

function countNodeItems(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null).length;
  if (isObject(value)) return Object.keys(value).length;
  return 0;
}

function relationButton(label, attrs = {}, variant = "secondary") {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(" ");
  return `<button class="${variant}" ${attrText} type="button">${escapeHtml(label)}</button>`;
}

function relationChip(title, meta, actions = "") {
  return `<div class="relation-chip">
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta || "")}</span></div>
    <div class="chip-actions">${actions}</div>
  </div>`;
}

function setConnection(isLive, message) {
  els.connectionDot.classList.toggle("live", isLive);
  els.connectionText.textContent = message;
}

function renderAll() {
  if (!state.data) return;
  renderOverview();
  renderPeople();
  renderClassrooms();
  renderMarketing();
  renderAttendanceControls();
  renderRelationships();
  renderTree();
}

async function loadDatabase({ silent = false } = {}) {
  try {
    const data = await dbGet("");
    const nextJson = JSON.stringify(data || {});
    state.data = data || {};
    setConnection(true, "Live Firebase polling active");
    if (nextJson !== lastDatabaseJson) {
      lastDatabaseJson = nextJson;
      renderAll();
    }
    if (!silent) showAlert("Data refreshed.");
  } catch (error) {
    setConnection(false, "Firebase connection failed");
    showAlert(error.message, "error");
  }
}

function startPolling() {
  clearInterval(pollTimer);
  loadDatabase({ silent: true });
  pollTimer = setInterval(() => loadDatabase({ silent: true }), 5000);
}

startPolling();

$("#refreshBtn").addEventListener("click", async () => {
  await loadDatabase();
});

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

function switchView(view) {
  state.view = view;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.id === view));
}

function renderOverview() {
  const data = state.data || {};
  const notes = Object.keys(data).filter((key) => /_NOTES$/.test(key)).length;
  const homework = Object.keys(data).filter((key) => /_HOMEWORK$/.test(key)).length;
  const stats = [
    ["Admins", objectEntries(data.ADMIN).length],
    ["Students", objectEntries(data.STUDENTS).length],
    ["Classrooms", objectEntries(data.CLASSROOMS).length],
    ["Notes/Homework Nodes", notes + homework],
  ];

  els.statsGrid.innerHTML = stats
    .map(([label, value]) => `<article class="stat"><span class="muted">${label}</span><strong>${value}</strong></article>`)
    .join("");

  els.rootNodeList.innerHTML = objectEntries(data)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, value]) => {
      return `<button class="node-row" data-root-node="${escapeHtml(key)}" type="button">
        <span class="row-title"><span>${escapeHtml(key)}</span><span>${nodeType(value)}</span></span>
        <span class="row-meta">${escapeHtml(summaryFor(value))}</span>
      </button>`;
    })
    .join("");

  $$("[data-root-node]").forEach((button) => {
    button.addEventListener("click", () => {
      state.treePath = button.dataset.rootNode;
      switchView("tree");
      renderTree();
    });
  });

  renderGlobalSearch();
}

function nodeType(value) {
  if (Array.isArray(value)) return "array";
  if (isObject(value)) return "object";
  if (value === null) return "null";
  return typeof value;
}

els.globalSearch.addEventListener("input", renderGlobalSearch);
els.relationshipSearch.addEventListener("input", renderRelationships);
$("#openTreeRoot").addEventListener("click", () => {
  state.treePath = "";
  switchView("tree");
  renderTree();
});

function renderGlobalSearch() {
  const query = els.globalSearch.value.trim().toLowerCase();
  if (!query || !state.data) {
    els.searchCount.textContent = "No search yet";
    els.searchResults.textContent = "Type to find names, emails, classroom IDs, notes, feedback, or any new node.";
    return;
  }

  const results = [];
  walk(state.data, "", (path, value) => {
    const haystack = `${path} ${typeof value === "object" ? JSON.stringify(value) : value}`.toLowerCase();
    if (haystack.includes(query)) {
      results.push({ path, value });
    }
  });

  els.searchCount.textContent = `${results.length} matches`;
  els.searchResults.innerHTML = results.slice(0, 80).map((result) => {
    return `<button class="result-row" data-search-path="${escapeHtml(result.path)}" type="button">
      <span class="row-title">${escapeHtml(result.path || "/")}</span>
      <span class="row-meta">${escapeHtml(summaryFor(result.value))}</span>
    </button>`;
  }).join("") || "No matches.";

  $$("[data-search-path]").forEach((button) => {
    button.addEventListener("click", () => {
      state.treePath = button.dataset.searchPath;
      switchView("tree");
      renderTree();
    });
  });
}

function walk(value, path, visitor) {
  visitor(path, value);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    walk(child, childPath(path, key), visitor);
  }
}

function renderRelationships() {
  if (!state.data || !els.healthList) return;
  const graph = buildRelationshipGraph();
  const query = els.relationshipSearch.value.trim().toLowerCase();
  const healthItems = [
    ...graph.missing,
    ...graph.unassignedStudents.map((key) => ({
      type: "Unassigned student",
      message: `${key} is not assigned to any classroom.`,
      path: `STUDENTS/${key}`,
      open: { type: "STUDENTS", key },
      severity: "warn",
    })),
    ...graph.studentsWithoutAdmin.map((key) => ({
      type: "Student without admin",
      message: `${key} is not listed inside any admin STUDENTS field.`,
      path: `STUDENTS/${key}`,
      open: { type: "STUDENTS", key },
      severity: "warn",
    })),
    ...graph.classroomsWithoutStudents.map((key) => ({
      type: "Empty classroom",
      message: `${key} has no assigned students.`,
      path: `CLASSROOMS/${key}`,
      openClassroom: key,
      severity: "warn",
    })),
    ...graph.classroomsWithoutAdmin.map((key) => ({
      type: "Classroom without admin",
      message: `${key} is not listed in any admin VIRTUAL_ROOMS field.`,
      path: `CLASSROOMS/${key}`,
      openClassroom: key,
      severity: "warn",
    })),
    ...graph.assetNodesWithoutClassroom.map((key) => ({
      type: "Asset node without classroom",
      message: `/${key} exists, but no matching classroom was found.`,
      path: key,
      severity: "warn",
    })),
  ].filter((item) => `${item.type} ${item.message} ${item.path}`.toLowerCase().includes(query));

  const relationshipItems = [
    ...peopleRecords("ADMIN").map(([adminKey, admin]) => ({
      title: `${adminKey} - ${admin.FULL_NAME || admin.EMAIL || ""}`,
      meta: `${(graph.adminStudents[adminKey] || []).length} students, ${(graph.adminClassrooms[adminKey] || []).length} classrooms`,
      action: relationButton("Open", { "data-open-person-type": "ADMIN", "data-open-person-key": adminKey }),
    })),
    ...classroomRecords().map(([classroomKey, classroom]) => ({
      title: `${classroom.CLASSROOM_ID || classroomKey} - ${classroom.TITLE || ""}`,
      meta: `${(graph.classroomStudents[classroomKey] || []).length} students, ${(graph.classroomAdmins[classroomKey] || []).length} admins`,
      action: relationButton("Open", { "data-open-classroom-key": classroomKey }),
    })),
    ...peopleRecords("STUDENTS").map(([studentKey, student]) => ({
      title: `${studentKey} - ${student.FULL_NAME || student.EMAIL || ""}`,
      meta: `${(graph.studentClassrooms[studentKey] || []).length} classrooms, ${(graph.studentAdmins[studentKey] || []).length} admins`,
      action: relationButton("Open", { "data-open-person-type": "STUDENTS", "data-open-person-key": studentKey }),
    })),
  ].filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(query));

  els.healthCount.textContent = `${healthItems.length} items`;
  els.relationshipCount.textContent = `${relationshipItems.length} links`;
  els.healthList.innerHTML = healthItems.map((item) => {
    const actions = item.open
      ? relationButton("Open", { "data-open-person-type": item.open.type, "data-open-person-key": item.open.key })
      : item.openClassroom
        ? relationButton("Open", { "data-open-classroom-key": item.openClassroom })
        : relationButton("Open Path", { "data-open-tree-path": item.path });
    return `<div class="health-row ${escapeHtml(item.severity || "warn")}">
      <div><strong>${escapeHtml(item.type)}</strong><span>${escapeHtml(item.message)}</span><small>/${escapeHtml(item.path)}</small></div>
      <div class="chip-actions">${actions}</div>
    </div>`;
  }).join("") || `<div class="muted">No relationship issues found for this filter.</div>`;

  els.relationshipList.innerHTML = relationshipItems.map((item) => {
    return relationChip(item.title, item.meta, item.action);
  }).join("") || `<div class="muted">No relationship records match this filter.</div>`;
}

$$("[data-people-type]").forEach((button) => {
  button.addEventListener("click", () => {
    state.peopleType = button.dataset.peopleType;
    state.selectedPersonKey = "";
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.peopleType === state.peopleType));
    renderPeople();
  });
});

els.peopleSearch.addEventListener("input", renderPeople);
$("#newAdminBtn").addEventListener("click", () => createNewPerson("ADMIN"));
$("#newStudentBtn").addEventListener("click", () => createNewPerson("STUDENTS"));
els.deletePersonBtn.addEventListener("click", deleteSelectedPerson);

function peopleRecords(type = state.peopleType) {
  return objectEntries((state.data || {})[type]).sort(([a, av], [b, bv]) => {
    return String(labelForKey(a, av)).localeCompare(String(labelForKey(b, bv)), undefined, { numeric: true });
  });
}

function renderPeople() {
  if (!state.data) return;
  const query = els.peopleSearch.value.trim().toLowerCase();
  const records = peopleRecords().filter(([key, value]) => {
    return `${key} ${JSON.stringify(value)}`.toLowerCase().includes(query);
  });

  els.peopleList.innerHTML = records.map(([key, value]) => {
    const title = labelForKey(key, value);
    const meta = state.peopleType === "ADMIN"
      ? `${value.EMAIL || ""} ${value.SUBJECTS ? `- ${value.SUBJECTS}` : ""}`
      : `${value.EMAIL || ""} ${value.VIRTUAL_ROOMS ? `- Rooms ${value.VIRTUAL_ROOMS}` : ""}`;
    return `<button class="record ${key === state.selectedPersonKey ? "active" : ""}" data-person-key="${escapeHtml(key)}" type="button">
      <span class="row-title"><span>${escapeHtml(title)}</span><span>${escapeHtml(key)}</span></span>
      <span class="row-meta">${escapeHtml(meta.trim())}</span>
    </button>`;
  }).join("") || `<div class="muted">No ${state.peopleType.toLowerCase()} records found.</div>`;

  $$("[data-person-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPersonKey = button.dataset.personKey;
      renderPeople();
    });
  });

  renderPersonForm();
}

async function createNewPerson(type) {
  state.peopleType = type;
  state.selectedPersonKey = type === "ADMIN"
    ? await reserveNumber("NUMBERS/ID_ADMIN/NUMBER", 1, "ADMIN_")
    : await reserveNumber("NUMBERS/ID_STUDENT/NUMBER", 1, "STUDENTS_");

  const defaults = type === "ADMIN"
    ? { FULL_NAME: "", EMAIL: "", PASSWORD: "", TEL: "", APPROVAL: "pending", VIRTUAL_ROOMS: "", STUDENTS: "" }
    : { FULL_NAME: "", EMAIL: "", PASSWORD: "123456", TEL: "", R_PARTY: "", R_PARTY_TEL: "", VIRTUAL_ROOMS: "" };

  await dbSet(`${type}/${state.selectedPersonKey}`, defaults);
  showAlert(`${state.selectedPersonKey} created. Fill the form and save.`);
  switchView("people");
}

async function reserveNumber(counterPath, minimum, prefix) {
  let reservedNumber = minimum;
  await dbTransaction(counterPath, (current) => {
    const parsed = Number.parseInt(current, 10);
    reservedNumber = Number.isFinite(parsed) ? parsed : minimum;
    return reservedNumber + 1;
  });
  return `${prefix}${reservedNumber}`;
}

function renderPersonForm() {
  const type = state.peopleType;
  const key = state.selectedPersonKey;
  const record = getAtPath(state.data, `${type}/${key}`);

  if (!key || !record) {
    els.personEditorTitle.textContent = "Select a record";
    els.deletePersonBtn.classList.add("hidden");
    els.personForm.innerHTML = `<div class="muted wide">Choose an admin or student to edit.</div>`;
    els.personRelations.innerHTML = "";
    return;
  }

  els.personEditorTitle.textContent = `${key} - ${labelForKey(key, record)}`;
  els.deletePersonBtn.classList.remove("hidden");
  els.personForm.innerHTML = buildFormFields(record, personFields[type], "person");
  els.personForm.onsubmit = savePersonForm;
  renderPersonRelations();
}

async function savePersonForm(event) {
  event.preventDefault();
  const key = state.selectedPersonKey;
  const payload = formPayload(els.personForm);
  await dbUpdate(`${state.peopleType}/${key}`, payload);
  showAlert(`${key} updated.`);
}

async function deleteSelectedPerson() {
  const key = state.selectedPersonKey;
  if (!key || !confirm(`Delete ${key}? This cannot be undone.`)) return;
  await dbRemove(`${state.peopleType}/${key}`);
  state.selectedPersonKey = "";
  showAlert(`${key} deleted.`);
}

function renderPersonRelations() {
  const key = state.selectedPersonKey;
  const type = state.peopleType;
  if (!key || !els.personRelations) {
    return;
  }
  const graph = buildRelationshipGraph();

  if (type === "ADMIN") {
    const studentIds = graph.adminStudents[key] || [];
    const classroomIds = graph.adminClassrooms[key] || [];
    const unlinkedStudents = peopleRecords("STUDENTS").filter(([studentKey]) => !studentIds.includes(studentKey));
    const unlinkedClassrooms = classroomRecords().filter(([, classroom]) => !classroomIds.includes(String(classroom.CLASSROOM_ID)));

    els.personRelations.innerHTML = `
      <section class="relation-card">
        <div class="relation-heading"><h4>Students managed by this admin</h4><span>${studentIds.length}</span></div>
        <div class="inline-editor">
          <select id="adminStudentSelect">${unlinkedStudents.map(([studentKey]) => `<option value="${escapeHtml(studentKey)}">${escapeHtml(recordLabel("STUDENTS", studentKey))}</option>`).join("")}</select>
          ${relationButton("Link Student", { "data-link-admin-student": key })}
        </div>
        <div class="relation-list">${studentIds.map((studentKey) => {
          const student = getAtPath(state.data, `STUDENTS/${studentKey}`);
          const actions = `${relationButton("Open", { "data-open-person-type": "STUDENTS", "data-open-person-key": studentKey })}${relationButton("Remove", { "data-unlink-admin-student": key, "data-student-key": studentKey }, "danger ghost")}`;
          return relationChip(studentKey, student ? student.FULL_NAME || student.EMAIL || "" : "Missing student node", actions);
        }).join("") || `<div class="muted">No student IDs linked.</div>`}</div>
      </section>
      <section class="relation-card">
        <div class="relation-heading"><h4>Classrooms managed by this admin</h4><span>${classroomIds.length}</span></div>
        <div class="inline-editor">
          <select id="adminClassroomSelect">${unlinkedClassrooms.map(([classroomKey, classroom]) => `<option value="${escapeHtml(String(classroom.CLASSROOM_ID))}">${escapeHtml(recordLabel("CLASSROOMS", classroomKey))}</option>`).join("")}</select>
          ${relationButton("Link Classroom", { "data-link-admin-classroom": key })}
        </div>
        <div class="relation-list">${classroomIds.map((classroomId) => {
          const classroomKey = classroomKeyById(classroomId);
          const actions = classroomKey
            ? `${relationButton("Open", { "data-open-classroom-key": classroomKey })}${relationButton("Remove", { "data-unlink-admin-classroom": key, "data-classroom-id": classroomId }, "danger ghost")}`
            : relationButton("Open Field", { "data-open-tree-path": `ADMIN/${key}/VIRTUAL_ROOMS` });
          return relationChip(`Classroom ${classroomId}`, classroomKey ? recordLabel("CLASSROOMS", classroomKey) : "Missing classroom node", actions);
        }).join("") || `<div class="muted">No classroom IDs linked.</div>`}</div>
      </section>
    `;
    return;
  }

  const classroomIds = graph.studentClassrooms[key] || [];
  const adminIds = graph.studentAdmins[key] || [];
  const availableClassrooms = classroomRecords().filter(([, classroom]) => !classroomIds.includes(String(classroom.CLASSROOM_ID)));
  els.personRelations.innerHTML = `
    <section class="relation-card">
      <div class="relation-heading"><h4>Classrooms assigned to this student</h4><span>${classroomIds.length}</span></div>
      <div class="inline-editor">
        <select id="studentClassroomSelect">${availableClassrooms.map(([classroomKey, classroom]) => `<option value="${escapeHtml(String(classroom.CLASSROOM_ID))}">${escapeHtml(recordLabel("CLASSROOMS", classroomKey))}</option>`).join("")}</select>
        ${relationButton("Assign Classroom", { "data-link-student-classroom": key })}
      </div>
      <div class="relation-list">${classroomIds.map((classroomId) => {
        const classroomKey = classroomKeyById(classroomId);
        const actions = classroomKey
          ? `${relationButton("Open", { "data-open-classroom-key": classroomKey })}${relationButton("Remove", { "data-unlink-student-classroom": key, "data-classroom-id": classroomId }, "danger ghost")}`
          : relationButton("Open Field", { "data-open-tree-path": `STUDENTS/${key}/VIRTUAL_ROOMS` });
        return relationChip(`Classroom ${classroomId}`, classroomKey ? recordLabel("CLASSROOMS", classroomKey) : "Missing classroom node", actions);
      }).join("") || `<div class="muted">No classrooms assigned.</div>`}</div>
    </section>
    <section class="relation-card">
      <div class="relation-heading"><h4>Admins referencing this student</h4><span>${adminIds.length}</span></div>
      <div class="relation-list">${adminIds.map((adminKey) => {
        const actions = `${relationButton("Open", { "data-open-person-type": "ADMIN", "data-open-person-key": adminKey })}${relationButton("Remove", { "data-unlink-admin-student": adminKey, "data-student-key": key }, "danger ghost")}`;
        return relationChip(adminKey, recordLabel("ADMIN", adminKey), actions);
      }).join("") || `<div class="muted">No admin currently references this student.</div>`}</div>
    </section>
    ${relatedNodeSection("Feedback", graph.feedbackByStudent[key] || [], "FEEDBACK")}
    ${relatedNodeSection("Attendance records", graph.attendanceByStudent[key] || [])}
  `;
}

els.classroomSearch.addEventListener("input", renderClassrooms);
$("#newClassroomBtn").addEventListener("click", createNewClassroom);
els.deleteClassroomBtn.addEventListener("click", deleteSelectedClassroom);

function classroomRecords() {
  return objectEntries((state.data || {}).CLASSROOMS).sort(([a, av], [b, bv]) => {
    const left = Number(av?.CLASSROOM_ID) || Number(a.replace(/\D/g, ""));
    const right = Number(bv?.CLASSROOM_ID) || Number(b.replace(/\D/g, ""));
    return left - right;
  });
}

function renderClassrooms() {
  if (!state.data) return;
  const query = els.classroomSearch.value.trim().toLowerCase();
  const records = classroomRecords().filter(([key, value]) => `${key} ${JSON.stringify(value)}`.toLowerCase().includes(query));

  els.classroomList.innerHTML = records.map(([key, value]) => {
    return `<button class="record ${key === state.selectedClassroomKey ? "active" : ""}" data-classroom-key="${escapeHtml(key)}" type="button">
      <span class="row-title"><span>${escapeHtml(value.TITLE || key)}</span><span>${escapeHtml(String(value.CLASSROOM_ID || ""))}</span></span>
      <span class="row-meta">${escapeHtml(`${value.TEACHER_FULL_NAME || ""} ${value.STORAGE_FOLDER ? `- ${value.STORAGE_FOLDER}` : ""}`.trim())}</span>
    </button>`;
  }).join("") || `<div class="muted">No classroom records found.</div>`;

  $$("[data-classroom-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClassroomKey = button.dataset.classroomKey;
      renderClassrooms();
    });
  });

  renderClassroomForm();
}

els.marketingAdmin.addEventListener("change", () => {
  state.selectedMarketingAdminKey = els.marketingAdmin.value;
  state.selectedMarketingKey = "";
  renderMarketing();
});
$("#newMarketingBtn").addEventListener("click", createMarketingCampaign);
els.deleteMarketingBtn.addEventListener("click", deleteSelectedMarketingCampaign);

function marketingCampaignRecords(adminKey = state.selectedMarketingAdminKey) {
  const campaigns = getAtPath(state.data, `ADMIN/${adminKey}/MARKETING`);
  return objectEntries(campaigns).sort(([a, av], [b, bv]) => {
    const left = av?.SCHEDULE_START || av?.CAMPAIGN_NAME || a;
    const right = bv?.SCHEDULE_START || bv?.CAMPAIGN_NAME || b;
    return String(right).localeCompare(String(left), undefined, { numeric: true });
  });
}

function renderMarketing() {
  if (!state.data || !els.marketingAdmin) return;
  const admins = peopleRecords("ADMIN");
  if (!state.selectedMarketingAdminKey && admins.length) {
    state.selectedMarketingAdminKey = admins[0][0];
  }

  const previousAdmin = state.selectedMarketingAdminKey;
  els.marketingAdmin.innerHTML = admins.map(([key, admin]) => {
    return `<option value="${escapeHtml(key)}">${escapeHtml(`${key} - ${admin.FULL_NAME || admin.EMAIL || ""}`)}</option>`;
  }).join("");
  if (previousAdmin) els.marketingAdmin.value = previousAdmin;

  const campaigns = marketingCampaignRecords();
  els.marketingList.innerHTML = campaigns.map(([key, campaign]) => {
    return `<button class="record ${key === state.selectedMarketingKey ? "active" : ""}" data-marketing-key="${escapeHtml(key)}" type="button">
      <span class="row-title"><span>${escapeHtml(campaign.CAMPAIGN_NAME || key)}</span><span>${escapeHtml(campaign.STATUS || "Unknown")}</span></span>
      <span class="row-meta">${escapeHtml(marketingCampaignSummary(campaign))}</span>
    </button>`;
  }).join("") || `<div class="muted">No marketing campaigns have been added for this teacher.</div>`;

  $$("[data-marketing-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMarketingKey = button.dataset.marketingKey;
      renderMarketing();
    });
  });

  renderMarketingForm();
}

function marketingCampaignSummary(campaign = {}) {
  const schedule = campaign.SCHEDULE_START && campaign.SCHEDULE_END
    ? `${campaign.SCHEDULE_START} to ${campaign.SCHEDULE_END}`
    : "Schedule not set";
  const packageName = campaign.SELECTED_PACKAGE || "package not set";
  return `${schedule} - ${packageName}`;
}

async function createMarketingCampaign() {
  const adminKey = state.selectedMarketingAdminKey || els.marketingAdmin.value;
  if (!adminKey) return showAlert("Choose a teacher before creating a campaign.", "error");
  const key = nextMarketingCampaignKey(adminKey);
  const payload = {
    CAMPAIGN_NAME: "",
    STATUS: "Draft",
    SCHEDULE_START: "",
    SCHEDULE_END: "",
    MESSAGING_CONVERSATIONS_STARTED: 0,
    REACH: 0,
    IMPRESSIONS: 0,
    SELECTED_PACKAGE: "launch",
    AMOUNT_SPENT_MUR: 0,
    STUDENTS_ACQUIRED: 0,
  };
  await dbSet(`ADMIN/${adminKey}/MARKETING/${key}`, payload);
  state.selectedMarketingKey = key;
  await loadDatabase({ silent: true });
  showAlert(`${key} created for ${adminKey}.`);
  switchView("marketing");
}

function nextMarketingCampaignKey(adminKey) {
  const campaigns = marketingCampaignRecords(adminKey);
  const highest = campaigns.reduce((max, [key]) => {
    const match = key.match(/^MARKETING_(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `MARKETING_${highest + 1}`;
}

function renderMarketingForm() {
  const adminKey = state.selectedMarketingAdminKey;
  const key = state.selectedMarketingKey;
  const campaign = getAtPath(state.data, `ADMIN/${adminKey}/MARKETING/${key}`);
  if (!adminKey || !key || !campaign) {
    els.marketingEditorTitle.textContent = "Select a campaign";
    els.deleteMarketingBtn.classList.add("hidden");
    els.marketingForm.innerHTML = `<div class="muted wide">Choose a campaign or create a new one.</div>`;
    return;
  }

  els.marketingEditorTitle.textContent = `${key} - ${campaign.CAMPAIGN_NAME || "Untitled campaign"}`;
  els.deleteMarketingBtn.classList.remove("hidden");
  els.marketingForm.innerHTML = `
    <label class="wide">Campaign name<input name="CAMPAIGN_NAME" value="${escapeHtml(campaign.CAMPAIGN_NAME || "")}" required></label>
    <label>Status<select name="STATUS">${["Draft", "In progress", "Active", "Paused", "Completed", "Cancelled"].map((status) => `<option value="${status}" ${campaign.STATUS === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
    <label>Selected package<select name="SELECTED_PACKAGE">${[
      ["launch", "Launch"],
      ["growth", "Growth"],
      ["premium", "Premium"],
    ].map(([value, label]) => `<option value="${value}" ${campaign.SELECTED_PACKAGE === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label>Schedule start<input name="SCHEDULE_START" type="date" value="${escapeHtml(campaign.SCHEDULE_START || "")}"></label>
    <label>Schedule end<input name="SCHEDULE_END" type="date" value="${escapeHtml(campaign.SCHEDULE_END || "")}"></label>
    <label>Messaging conversations started<input name="MESSAGING_CONVERSATIONS_STARTED" type="number" min="0" step="1" value="${escapeHtml(campaign.MESSAGING_CONVERSATIONS_STARTED ?? 0)}"></label>
    <label>Reach<input name="REACH" type="number" min="0" step="1" value="${escapeHtml(campaign.REACH ?? 0)}"></label>
    <label>Impressions<input name="IMPRESSIONS" type="number" min="0" step="1" value="${escapeHtml(campaign.IMPRESSIONS ?? 0)}"></label>
    <label>Money spent (MUR)<input name="AMOUNT_SPENT_MUR" type="number" min="0" step="1" value="${escapeHtml(campaign.AMOUNT_SPENT_MUR ?? 0)}"></label>
    <label>Students gotten through ads<input name="STUDENTS_ACQUIRED" type="number" min="0" step="1" value="${escapeHtml(campaign.STUDENTS_ACQUIRED ?? 0)}"></label>
    <div class="form-actions"><button class="secondary" type="button" data-open-tree-path="ADMIN/${escapeHtml(adminKey)}/MARKETING/${escapeHtml(key)}">Open in Tree</button><button type="submit">Save Campaign</button></div>
  `;
  els.marketingForm.onsubmit = saveMarketingCampaign;
}

async function saveMarketingCampaign(event) {
  event.preventDefault();
  const adminKey = state.selectedMarketingAdminKey;
  const key = state.selectedMarketingKey;
  const payload = formPayload(els.marketingForm);
  await dbUpdate(`ADMIN/${adminKey}/MARKETING/${key}`, payload);
  await loadDatabase({ silent: true });
  showAlert(`${key} updated.`);
}

async function deleteSelectedMarketingCampaign() {
  const adminKey = state.selectedMarketingAdminKey;
  const key = state.selectedMarketingKey;
  if (!adminKey || !key || !confirm(`Delete ${key} from ${adminKey}?`)) return;
  await dbRemove(`ADMIN/${adminKey}/MARKETING/${key}`);
  state.selectedMarketingKey = "";
  await loadDatabase({ silent: true });
  showAlert(`${key} deleted.`);
}

async function createNewClassroom() {
  const key = await reserveClassroomKey();
  const id = Number(key.replace("CLASSROOM_", ""));
  const adminKey = objectEntries((state.data || {}).ADMIN)[0]?.[0] || "";
  const admin = getAtPath(state.data, `ADMIN/${adminKey}`) || {};
  const payload = {
    CLASSROOM_ID: id,
    TITLE: "",
    STORAGE_FOLDER: `${id}_NOTES`,
    TEACHER_FULL_NAME: admin.FULL_NAME || "",
    TEACHER_TEL: admin.TEL || "",
    TEACHER_ADDRESS: "",
    VR_LINK: admin.VR_LINK || "",
  };
  await dbSet(`CLASSROOMS/${key}`, payload);
  await dbSet(`NUMBERS/ID_CLASSROOM_${id}_NOTES/NUMBER`, 1);
  await dbSet(`NUMBERS/ID_CLASSROOM_${id}_HOMEWORK/NUMBER`, 1);
  state.selectedClassroomKey = key;
  showAlert(`${key} created with note and homework counters.`);
  switchView("classrooms");
}

async function reserveClassroomKey() {
  let id = 1000;
  await dbTransaction("NUMBERS/CURRENT_ID_CLASSROOM/NUMBER", (current) => {
    id = (Number.parseInt(current, 10) || 1000) + 1;
    return id;
  });
  return `CLASSROOM_${id}`;
}

function renderClassroomForm() {
  const key = state.selectedClassroomKey;
  const record = getAtPath(state.data, `CLASSROOMS/${key}`);
  if (!key || !record) {
    els.classroomEditorTitle.textContent = "Select a classroom";
    els.deleteClassroomBtn.classList.add("hidden");
    els.classroomForm.innerHTML = `<div class="muted wide">Choose a classroom to edit.</div>`;
    els.classroomRelations.innerHTML = "";
    return;
  }

  els.classroomEditorTitle.textContent = `${key} - ${record.TITLE || "Untitled"}`;
  els.deleteClassroomBtn.classList.remove("hidden");
  els.classroomForm.innerHTML = buildFormFields(record, classroomFields, "classroom");
  els.classroomForm.onsubmit = saveClassroomForm;
  renderClassroomRelations();
}

async function saveClassroomForm(event) {
  event.preventDefault();
  const key = state.selectedClassroomKey;
  await dbUpdate(`CLASSROOMS/${key}`, formPayload(els.classroomForm));
  showAlert(`${key} updated.`);
}

async function deleteSelectedClassroom() {
  const key = state.selectedClassroomKey;
  const classroom = getAtPath(state.data, `CLASSROOMS/${key}`);
  if (!key || !confirm(`Delete ${key}? This will also remove the classroom's notes/homework nodes and counters.`)) return;
  const id = classroom.CLASSROOM_ID;
  await dbRemove(`CLASSROOMS/${key}`);
  if (classroom.STORAGE_FOLDER) await dbRemove(classroom.STORAGE_FOLDER);
  if (id) {
    await dbRemove(`${id}_HOMEWORK`);
    await dbRemove(`NUMBERS/ID_CLASSROOM_${id}_NOTES`);
    await dbRemove(`NUMBERS/ID_CLASSROOM_${id}_HOMEWORK`);
  }
  state.selectedClassroomKey = "";
  showAlert(`${key} deleted.`);
}

function renderClassroomRelations() {
  const key = state.selectedClassroomKey;
  const classroom = getAtPath(state.data, `CLASSROOMS/${key}`);
  if (!key || !classroom || !els.classroomRelations) return;

  const graph = buildRelationshipGraph();
  const classroomId = String(classroom.CLASSROOM_ID || "");
  const studentIds = graph.classroomStudents[key] || [];
  const adminIds = graph.classroomAdmins[key] || [];
  const assets = graph.classroomAssets[key] || {};
  const availableStudents = peopleRecords("STUDENTS").filter(([studentKey]) => !studentIds.includes(studentKey));
  const attendancePaths = [];
  walk((state.data || {}).ATTENDANCE || {}, "ATTENDANCE", (path, value) => {
    if (path.includes(`/CLASSROOM_${classroomId}`) && isObject(value)) attendancePaths.push(path);
  });

  els.classroomRelations.innerHTML = `
    <section class="relation-card">
      <div class="relation-heading"><h4>Students in this classroom</h4><span>${studentIds.length}</span></div>
      <div class="inline-editor">
        <select id="classroomStudentSelect">${availableStudents.map(([studentKey]) => `<option value="${escapeHtml(studentKey)}">${escapeHtml(recordLabel("STUDENTS", studentKey))}</option>`).join("")}</select>
        ${relationButton("Assign Student", { "data-link-classroom-student": key })}
      </div>
      <div class="relation-list">${studentIds.map((studentKey) => {
        const actions = `${relationButton("Open", { "data-open-person-type": "STUDENTS", "data-open-person-key": studentKey })}${relationButton("Remove", { "data-unlink-student-classroom": studentKey, "data-classroom-id": classroomId }, "danger ghost")}`;
        return relationChip(studentKey, recordLabel("STUDENTS", studentKey), actions);
      }).join("") || `<div class="muted">No students are assigned to this classroom.</div>`}</div>
    </section>
    <section class="relation-card">
      <div class="relation-heading"><h4>Admins managing this classroom</h4><span>${adminIds.length}</span></div>
      <div class="relation-list">${adminIds.map((adminKey) => {
        const actions = `${relationButton("Open", { "data-open-person-type": "ADMIN", "data-open-person-key": adminKey })}${relationButton("Remove", { "data-unlink-admin-classroom": adminKey, "data-classroom-id": classroomId }, "danger ghost")}`;
        return relationChip(adminKey, recordLabel("ADMIN", adminKey), actions);
      }).join("") || `<div class="muted">No admin has this classroom in VIRTUAL_ROOMS.</div>`}</div>
    </section>
    <section class="relation-card">
      <div class="relation-heading"><h4>Notes and homework nodes</h4><span>${(assets.noteCount || 0) + (assets.homeworkCount || 0)}</span></div>
      <div class="relation-list">
        ${assetChip("Notes", assets.notesPath, assets.noteCount, `${classroomId}_NOTES`)}
        ${assetChip("Homework", assets.homeworkPath, assets.homeworkCount, `${classroomId}_HOMEWORK`)}
      </div>
    </section>
    ${relatedNodeSection("Attendance paths", attendancePaths)}
  `;
}

function assetChip(label, path, count, defaultPath) {
  const targetPath = path || defaultPath;
  const actions = path
    ? relationButton("Open", { "data-open-tree-path": targetPath })
    : relationButton("Create", { "data-create-empty-node": targetPath });
  return relationChip(label, path ? `${count || 0} records at /${path}` : `Missing /${defaultPath}`, actions);
}

function relatedNodeSection(title, paths, rootPrefix = "") {
  return `<section class="relation-card">
    <div class="relation-heading"><h4>${escapeHtml(title)}</h4><span>${paths.length}</span></div>
    <div class="relation-list">${paths.slice(0, 40).map((path) => {
      const fullPath = rootPrefix ? `${rootPrefix}/${path}` : path;
      return relationChip(fullPath, summaryFor(getAtPath(state.data, fullPath)), relationButton("Open", { "data-open-tree-path": fullPath }));
    }).join("") || `<div class="muted">No related nodes found.</div>`}</div>
  </section>`;
}

function buildFormFields(record, preferredFields, namespace) {
  const allFields = [...new Set([...preferredFields, ...Object.keys(record || {})])];
  const fields = allFields.map((field) => {
    const value = record?.[field] ?? "";
    const isWide = String(value).length > 60 || ["BIO", "REASON", "STUDENTS", "VIRTUAL_ROOMS", "PROFILE_LINK", "VR_LINK", "WHITEBOARD"].includes(field);
    if (isObject(value) || Array.isArray(value)) {
      return `<label class="wide">${escapeHtml(field)}<textarea name="${escapeHtml(field)}" data-json-field="true">${escapeHtml(safeJson(value))}</textarea></label>`;
    }
    return `<label class="${isWide ? "wide" : ""}">${escapeHtml(field)}<input name="${escapeHtml(field)}" value="${escapeHtml(value)}" data-field="${namespace}"></label>`;
  }).join("");

  return `${fields}<div class="form-actions"><button class="secondary" type="button" data-open-json>Open in Tree</button><button type="submit">Save Changes</button></div>`;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.openPersonKey) {
    openPerson(button.dataset.openPersonType, button.dataset.openPersonKey);
    return;
  }

  if (button.dataset.openClassroomKey) {
    openClassroom(button.dataset.openClassroomKey);
    return;
  }

  if (button.dataset.openTreePath !== undefined) {
    openTreePath(button.dataset.openTreePath);
    return;
  }

  if (button.dataset.createEmptyNode) {
    await dbSet(button.dataset.createEmptyNode, {});
    await loadDatabase({ silent: true });
    openTreePath(button.dataset.createEmptyNode);
    showAlert(`/${button.dataset.createEmptyNode} created.`);
    return;
  }

  if (button.dataset.linkAdminStudent) {
    const studentKey = $("#adminStudentSelect")?.value;
    if (studentKey) await addCsvRelation(`ADMIN/${button.dataset.linkAdminStudent}/STUDENTS`, studentKey, "Student linked.");
    return;
  }

  if (button.dataset.unlinkAdminStudent) {
    await removeCsvRelation(`ADMIN/${button.dataset.unlinkAdminStudent}/STUDENTS`, button.dataset.studentKey, "Student link removed.");
    return;
  }

  if (button.dataset.linkAdminClassroom) {
    const classroomId = $("#adminClassroomSelect")?.value;
    if (classroomId) await addCsvRelation(`ADMIN/${button.dataset.linkAdminClassroom}/VIRTUAL_ROOMS`, classroomId, "Classroom linked.");
    return;
  }

  if (button.dataset.unlinkAdminClassroom) {
    await removeCsvRelation(`ADMIN/${button.dataset.unlinkAdminClassroom}/VIRTUAL_ROOMS`, button.dataset.classroomId, "Classroom link removed.");
    return;
  }

  if (button.dataset.linkStudentClassroom) {
    const classroomId = $("#studentClassroomSelect")?.value;
    if (classroomId) await addCsvRelation(`STUDENTS/${button.dataset.linkStudentClassroom}/VIRTUAL_ROOMS`, classroomId, "Classroom assigned.");
    return;
  }

  if (button.dataset.linkClassroomStudent) {
    const studentKey = $("#classroomStudentSelect")?.value;
    const classroom = getAtPath(state.data, `CLASSROOMS/${button.dataset.linkClassroomStudent}`);
    if (studentKey && classroom?.CLASSROOM_ID) {
      await addCsvRelation(`STUDENTS/${studentKey}/VIRTUAL_ROOMS`, String(classroom.CLASSROOM_ID), "Student assigned.");
    }
    return;
  }

  if (button.dataset.unlinkStudentClassroom) {
    await removeCsvRelation(`STUDENTS/${button.dataset.unlinkStudentClassroom}/VIRTUAL_ROOMS`, button.dataset.classroomId, "Classroom assignment removed.");
    return;
  }

  if (!button.matches("[data-open-json]")) return;
  if (state.view === "people" && state.selectedPersonKey) {
    state.treePath = `${state.peopleType}/${state.selectedPersonKey}`;
  }
  if (state.view === "classrooms" && state.selectedClassroomKey) {
    state.treePath = `CLASSROOMS/${state.selectedClassroomKey}`;
  }
  switchView("tree");
  renderTree();
});

function openPerson(type, key) {
  state.peopleType = type;
  state.selectedPersonKey = key;
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.peopleType === state.peopleType));
  switchView("people");
  renderPeople();
}

function openClassroom(key) {
  state.selectedClassroomKey = key;
  switchView("classrooms");
  renderClassrooms();
}

function openTreePath(path) {
  state.treePath = cleanPath(path);
  switchView("tree");
  renderTree();
}

async function addCsvRelation(path, value, message) {
  const current = csvIds(getAtPath(state.data, path));
  if (!current.includes(value)) current.push(value);
  await dbSet(path, current.join(","));
  await loadDatabase({ silent: true });
  showAlert(message);
}

async function removeCsvRelation(path, value, message) {
  const current = csvIds(getAtPath(state.data, path)).filter((item) => item !== value);
  await dbSet(path, current.join(","));
  await loadDatabase({ silent: true });
  showAlert(message);
}

function formPayload(form) {
  const payload = {};
  new FormData(form).forEach((value, key) => {
    const input = form.elements[key];
    if (input?.dataset?.jsonField === "true") {
      const parsed = parseEditorJson(value);
      if (!parsed.ok) throw new Error(`${key} must contain valid JSON.`);
      payload[key] = parsed.value;
      return;
    }
    payload[key] = coerceValue(value);
  });
  return payload;
}

function coerceValue(value) {
  const text = String(value).trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text !== "" && /^-?\d+(\.\d+)?$/.test(text) && !/^0\d+/.test(text)) return Number(text);
  return value;
}

els.attendanceDate.valueAsDate = new Date();
["change", "input"].forEach((eventName) => {
  els.attendanceDate.addEventListener(eventName, renderAttendanceList);
  els.attendanceAdmin.addEventListener(eventName, renderAttendanceList);
  els.attendanceClassroom.addEventListener(eventName, renderAttendanceList);
});
$("#saveAttendanceBtn").addEventListener("click", saveAttendance);

function renderAttendanceControls() {
  if (!state.data) return;
  const admins = peopleRecords("ADMIN");
  const classrooms = classroomRecords();

  const previousAdmin = els.attendanceAdmin.value;
  const previousClassroom = els.attendanceClassroom.value;
  els.attendanceAdmin.innerHTML = admins.map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(`${key} - ${value.FULL_NAME || value.EMAIL || ""}`)}</option>`).join("");
  els.attendanceClassroom.innerHTML = classrooms.map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(`${value.CLASSROOM_ID || key} - ${value.TITLE || ""}`)}</option>`).join("");
  if (previousAdmin) els.attendanceAdmin.value = previousAdmin;
  if (previousClassroom) els.attendanceClassroom.value = previousClassroom;
  renderAttendanceList();
}

function renderAttendanceList() {
  const date = els.attendanceDate.value;
  const adminKey = els.attendanceAdmin.value;
  const classroomKey = els.attendanceClassroom.value;
  const classroom = getAtPath(state.data, `CLASSROOMS/${classroomKey}`);
  if (!date || !adminKey || !classroom) {
    els.attendanceList.textContent = "Choose a date, admin, and classroom.";
    return;
  }

  const classroomId = classroom.CLASSROOM_ID;
  const students = peopleRecords("STUDENTS").filter(([, student]) => csvIds(student.VIRTUAL_ROOMS).includes(String(classroomId)));
  const existing = attendanceNode(date, adminKey, classroomId);
  state.attendanceRecords = {};

  els.attendanceList.innerHTML = students.map(([key, student]) => {
    const record = existing?.[key] || {};
    const status = record.attendance || "present";
    state.attendanceRecords[key] = {
      full_name: record.full_name || student.FULL_NAME || key,
      attendance: status,
    };
    return `<div class="attendance-row">
      <div><strong>${escapeHtml(student.FULL_NAME || key)}</strong><div class="row-meta">${escapeHtml(key)}</div></div>
      <select data-attendance-key="${escapeHtml(key)}">
        <option value="present" ${status === "present" ? "selected" : ""}>present</option>
        <option value="absent" ${status === "absent" ? "selected" : ""}>absent</option>
      </select>
    </div>`;
  }).join("") || `<div class="muted">No students are assigned to this classroom.</div>`;

  $$("[data-attendance-key]").forEach((select) => {
    select.addEventListener("change", () => {
      state.attendanceRecords[select.dataset.attendanceKey].attendance = select.value;
    });
  });
}

function attendanceNode(dateValue, adminKey, classroomId) {
  const [year, month, day] = dateValue.split("-");
  return getAtPath(state.data, `ATTENDANCE/${year}/${month}/${day}/${adminKey}/CLASSROOM_${classroomId}`)
    || getAtPath(state.data, `ATTENDANCE/${year}/${month}/${day}/${adminKey}`);
}

async function saveAttendance() {
  const date = els.attendanceDate.value;
  const adminKey = els.attendanceAdmin.value;
  const classroom = getAtPath(state.data, `CLASSROOMS/${els.attendanceClassroom.value}`);
  if (!date || !adminKey || !classroom) return showAlert("Choose a date, admin, and classroom first.", "error");
  const [year, month, day] = date.split("-");
  const path = `ATTENDANCE/${year}/${month}/${day}/${adminKey}/CLASSROOM_${classroom.CLASSROOM_ID}`;
  await dbSet(path, state.attendanceRecords);
  showAlert(`Attendance saved for ${date}.`);
}

function csvIds(value) {
  return String(value || "").split(",").map((id) => id.trim()).filter(Boolean);
}

els.treeFilter.addEventListener("input", renderTree);
$("#treeSaveBtn").addEventListener("click", saveTreeNode);
$("#treeDeleteBtn").addEventListener("click", deleteTreeNode);
$("#treeAddChildBtn").addEventListener("click", () => {
  els.childKeyInput.value = "";
  els.childValueInput.value = "{}";
  els.childDialog.showModal();
});
$("#confirmChildBtn").addEventListener("click", addTreeChild);

function renderTree() {
  if (!state.data) return;
  const value = getAtPath(state.data, state.treePath);
  els.treeEditorTitle.textContent = `/${cleanPath(state.treePath)}`;
  els.treeNodeMeta.textContent = nodeType(value);
  els.treeEditor.value = safeJson(value);
  renderBreadcrumb();

  const filter = els.treeFilter.value.trim().toLowerCase();
  const children = objectEntries(value).filter(([key, child]) => `${key} ${summaryFor(child)}`.toLowerCase().includes(filter));
  els.treeChildren.innerHTML = children.map(([key, child]) => {
    const nextPath = childPath(state.treePath, key);
    return `<button class="node-row" data-tree-path="${escapeHtml(nextPath)}" type="button">
      <span class="row-title"><span>${escapeHtml(labelForKey(key, child))}</span><span>${escapeHtml(key)}</span></span>
      <span class="row-meta">${escapeHtml(nodeType(child))} - ${escapeHtml(summaryFor(child))}</span>
    </button>`;
  }).join("") || `<div class="muted">This node has no object children. Edit its JSON directly or add a child.</div>`;

  $$("[data-tree-path]").forEach((button) => {
    button.addEventListener("click", () => {
      state.treePath = button.dataset.treePath;
      renderTree();
    });
  });
}

function renderBreadcrumb() {
  const parts = pathParts(state.treePath);
  const buttons = [`<button data-breadcrumb-path="" type="button">/</button>`];
  parts.forEach((part, index) => {
    buttons.push(`<button data-breadcrumb-path="${escapeHtml(parts.slice(0, index + 1).join("/"))}" type="button">${escapeHtml(part)}</button>`);
  });
  els.breadcrumb.innerHTML = buttons.join("");
  $$("[data-breadcrumb-path]").forEach((button) => {
    button.addEventListener("click", () => {
      state.treePath = button.dataset.breadcrumbPath;
      renderTree();
    });
  });
}

async function saveTreeNode() {
  const parsed = parseEditorJson(els.treeEditor.value);
  if (!parsed.ok) return showAlert(`Invalid JSON: ${parsed.error.message}`, "error");
  await dbSet(state.treePath, parsed.value);
  showAlert(`/${cleanPath(state.treePath)} saved.`);
}

async function deleteTreeNode() {
  if (!state.treePath) return showAlert("The root node cannot be deleted from here.", "error");
  if (!confirm(`Delete /${state.treePath}? This cannot be undone.`)) return;
  await dbRemove(state.treePath);
  state.treePath = pathParts(state.treePath).slice(0, -1).join("/");
  showAlert("Node deleted.");
}

async function addTreeChild() {
  const key = els.childKeyInput.value.trim();
  if (!key || key.includes("/")) return showAlert("Use a child key without slashes.", "error");
  const parsed = parseEditorJson(els.childValueInput.value);
  if (!parsed.ok) return showAlert(`Invalid JSON: ${parsed.error.message}`, "error");
  const nextPath = childPath(state.treePath, key);
  await dbSet(nextPath, parsed.value);
  state.treePath = nextPath;
  els.childDialog.close();
  showAlert(`/${nextPath} added.`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
