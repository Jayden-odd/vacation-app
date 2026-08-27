import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyDCWDPFyTPv2GZVIuUs6CXfFxxNIEEXXDU",
  authDomain: "vacation-app-4fdc4.firebaseapp.com",
  projectId: "vacation-app-4fdc4",
  storageBucket: "vacation-app-4fdc4.firebasestorage.app",
  messagingSenderId: "449859332219",
  appId: "1:449859332219:web:cade4e12ee4c87c74d5ade"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 직무별 정렬 가중치 (관리자: 1 ➔ 장비: 2 ➔ 피킹: 3)
const JOB_ORDER = { '관리자': 1, '장비': 2, '피킹': 3 };

// 전역 상태
let currentUser = null; 
let calendar = null;
let selectedDateStr = null;
let targetVacationDocId = null;

// 모달 조작 헬퍼 함수
function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

// 페이지 초기화 및 이벤트 등록
document.addEventListener('DOMContentLoaded', async () => {
  initCalendar();
  await loadGroupDropdowns();
  await ensureAdminExists();
  restoreSession();
  bindEvents();
});

// 모든 UI 이벤트 리스너 바인딩
function bindEvents() {
  document.getElementById('btn-open-login')?.addEventListener('click', () => openModal('login-modal'));
  document.getElementById('btn-open-register')?.addEventListener('click', () => openModal('register-modal'));
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleDarkMode);
  
  document.getElementById('register-form')?.addEventListener('submit', handleRegister);
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('btn-reset-password-login')?.addEventListener('click', resetPasswordOnLogin);
  
  document.getElementById('btn-open-mypage')?.addEventListener('click', openMyPage);
  document.getElementById('btn-open-admin')?.addEventListener('click', openAdminModal);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  
  document.getElementById('my-vacation-only')?.addEventListener('change', handleFilterChange);
  document.getElementById('admin-user-filter')?.addEventListener('change', handleFilterChange);
  
  // 그룹 필터 변경 시 사용자 드롭다운 갱신 및 캘린더 리프레시
  document.getElementById('admin-group-filter')?.addEventListener('change', async () => {
    await loadAdminUserDropdown();
    handleFilterChange();
  });
  
  document.getElementById('btn-vacation-cancel')?.addEventListener('click', cancelVacation);
  document.getElementById('btn-vacation-apply')?.addEventListener('click', applyVacation);
  
  document.getElementById('mypage-form')?.addEventListener('submit', handleUpdateProfile);
  document.getElementById('btn-reset-mypw')?.addEventListener('click', resetMyPasswordToPhone);
  
  // 그룹 생성 및 삭제 이벤트
  document.getElementById('btn-create-group')?.addEventListener('click', createGroup);
  document.getElementById('btn-delete-group')?.addEventListener('click', deleteGroup);

  // 모달 닫기 버튼 공통 처리
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetModalId = e.target.getAttribute('data-target');
      if (targetModalId) closeModal(targetModalId);
    });
  });
}

// 다크 모드 토글
function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark');
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');
  
  if (themeIcon) themeIcon.innerText = isDark ? '☀️' : '🌙';
  if (themeText) themeText.innerText = isDark ? '주간 모드' : '야간 모드';
}

// 세션 복구 (로컬 스토리지)
function restoreSession() {
  const savedUser = localStorage.getItem('vacation_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    updateUIForLoggedInUser();
  }
}

// 초기 admin 및 기본 그룹 생성
async function ensureAdminExists() {
  try {
    const adminRef = doc(db, "users", "admin");
    const adminSnap = await getDoc(adminRef);
    if (!adminSnap.exists()) {
      await setDoc(adminRef, {
        phone: "admin",
        name: "최고관리자",
        password: "admin",
        job: "관리자",
        group: "전체",
        role: "admin"
      });
    }
    
    const groupRef = doc(db, "groups", "A그룹");
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) {
      await setDoc(groupRef, { name: "A그룹" });
      await setDoc(doc(db, "groups", "B그룹"), { name: "B그룹" });
      await loadGroupDropdowns();
    }
  } catch (err) {
    console.error("초기화 실패:", err);
  }
}

// FullCalendar 초기화
function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ko',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: ''
    },
    height: 'auto',
    eventOrder: 'order',
    events: fetchVacations,

    eventDidMount: function(info) {
      info.el.style.cursor = 'pointer';
    },

    dateClick: function(info) {
      if (!currentUser) {
        alert('로그인 후 이용할 수 있습니다.');
        openModal('login-modal');
        return;
      }
      selectedDateStr = info.dateStr;
      targetVacationDocId = `${currentUser.id}_${selectedDateStr}`;
      
      document.getElementById('vacation-modal-date').innerText = `${selectedDateStr} 휴가 설정`;
      
      const infoBox = document.getElementById('vacation-target-info');
      if (infoBox) infoBox.classList.add('hidden');

      const descBox = document.getElementById('vacation-modal-desc');
      if (descBox) descBox.innerText = '선택하신 날짜에 휴가를 신청하거나 취소할 수 있습니다.';

      const btnApply = document.getElementById('btn-vacation-apply');
      if (btnApply) btnApply.classList.remove('hidden');

      const btnCancel = document.getElementById('btn-vacation-cancel');
      if (btnCancel) btnCancel.innerText = '내 휴가 취소';
      
      openModal('vacation-modal');
    },

    eventClick: function(info) {
      if (info.jsEvent) {
        info.jsEvent.preventDefault();
        info.jsEvent.stopPropagation();
      }

      if (!currentUser) return;

      const eventId = info.event.id;

      if (eventId.startsWith('work_')) {
        alert(`[근무자] ${info.event.title}`);
        return;
      }

      targetVacationDocId = eventId; 
      const eventTitle = info.event.title;
      const eventDate = info.event.startStr;

      const infoBox = document.getElementById('vacation-target-info');
      if (infoBox) {
        infoBox.innerHTML = `<strong>등록된 휴가:</strong> ${eventTitle} (${eventDate})`;
        infoBox.classList.remove('hidden');
      }

      document.getElementById('vacation-modal-date').innerText = `휴가 관리`;

      const isManagerOrAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
      const isMyVacation = eventId.startsWith(`${currentUser.id}_`);

      if (isManagerOrAdmin || isMyVacation) {
        const descBox = document.getElementById('vacation-modal-desc');
        if (descBox) {
          descBox.innerText = isManagerOrAdmin && !isMyVacation 
            ? '관리자 권한으로 해당 사용자 휴가를 취소할 수 있습니다.' 
            : '등록된 휴가를 취소하시겠습니까?';
        }

        const btnApply = document.getElementById('btn-vacation-apply');
        if (btnApply) btnApply.classList.add('hidden');

        const btnCancel = document.getElementById('btn-vacation-cancel');
        if (btnCancel) {
          btnCancel.innerText = isManagerOrAdmin && !isMyVacation ? '휴가 강제 취소' : '휴가 취소';
          btnCancel.classList.remove('hidden');
        }
        
        openModal('vacation-modal');
      } else {
        alert(`휴가 정보: ${eventTitle}`);
      }
    }
  });

  calendar.render();
}

// 휴가 및 근무자 데이터 로드
async function fetchVacations(fetchInfo, successCallback, failureCallback) {
  try {
    const adminFilterVal = document.getElementById('admin-user-filter')?.value;
    const selectedGroupVal = document.getElementById('admin-group-filter')?.value || 'ALL';

    // [근무자 보기 선택 시]
    if ((currentUser?.role === 'admin' || currentUser?.role === 'manager') && adminFilterVal === 'WORKING_ONLY') {
      let usersQuery = collection(db, "users");
      
      if (currentUser.role === 'manager') {
        usersQuery = query(collection(db, "users"), where("group", "==", currentUser.group));
      } else if (currentUser.role === 'admin' && selectedGroupVal !== 'ALL') {
        usersQuery = query(collection(db, "users"), where("group", "==", selectedGroupVal));
      }

      const usersSnap = await getDocs(usersQuery);
      const allUsers = [];
      usersSnap.forEach(d => {
        const u = d.data();
        allUsers.push({ id: d.id, ...u });
      });

      const vacSnap = await getDocs(collection(db, "vacations"));
      
      const vacationDateMap = {};
      vacSnap.forEach(d => {
        const vac = d.data();
        if (!vacationDateMap[vac.date]) vacationDateMap[vac.date] = new Set();
        vacationDateMap[vac.date].add(vac.userId);
      });

      let events = [];
      let cur = new Date(fetchInfo.startStr);
      const end = new Date(fetchInfo.endStr);

      while (cur < end) {
        const dateStr = cur.toISOString().split('T')[0];
        const onVacationSet = vacationDateMap[dateStr] || new Set();

        const workingUsers = allUsers.filter(user => !onVacationSet.has(user.id));
        
        workingUsers.sort((a, b) => (JOB_ORDER[a.job] || 99) - (JOB_ORDER[b.job] || 99));

        workingUsers.forEach(user => {
          let jobClass = 'vacation-picking';
          if (user.job === '관리자') jobClass = 'vacation-admin';
          else if (user.job === '장비') jobClass = 'vacation-equipment';

          const orderVal = JOB_ORDER[user.job] || 99;

          events.push({
            id: `work_${user.id}_${dateStr}`,
            title: user.name,
            start: dateStr,
            className: jobClass,
            order: orderVal
          });
        });

        cur.setDate(cur.getDate() + 1);
      }

      successCallback(events);
      return;
    }

    // [휴가 목록 보기 시]
    const querySnapshot = await getDocs(collection(db, "vacations"));
    let rawEvents = [];

    let targetGroup = null;
    if (currentUser) {
      if (currentUser.role === 'user' || currentUser.role === 'manager') {
        targetGroup = currentUser.group;
      } else if (currentUser.role === 'admin' && selectedGroupVal !== 'ALL') {
        targetGroup = selectedGroupVal;
      }
    }

    let filterTargetUserId = null;
    if (currentUser) {
      if (currentUser.role === 'admin' || currentUser.role === 'manager') {
        if (adminFilterVal && adminFilterVal !== 'ALL' && adminFilterVal !== 'WORKING_ONLY') {
          filterTargetUserId = adminFilterVal;
        }
      } else {
        const isMyOnly = document.getElementById('my-vacation-only')?.checked;
        if (isMyOnly) filterTargetUserId = currentUser.id;
      }
    }

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if (targetGroup && data.group !== targetGroup) return;
      if (filterTargetUserId && data.userId !== filterTargetUserId) return;

      let jobClass = 'vacation-picking';
      if (data.job === '관리자') jobClass = 'vacation-admin';
      else if (data.job === '장비') jobClass = 'vacation-equipment';

      const orderVal = JOB_ORDER[data.job] || 99;

      rawEvents.push({
        id: docSnap.id,
        title: data.userName,
        start: data.date,
        className: jobClass,
        order: orderVal,
        job: data.job
      });
    });

    rawEvents.sort((a, b) => a.order - b.order);

    successCallback(rawEvents);
  } catch (err) {
    console.error("데이터 로드 실패:", err);
    failureCallback(err);
  }
}

function handleFilterChange() {
  if (calendar) calendar.refetchEvents();
}

async function loadGroupDropdowns() {
  try {
    const snaps = await getDocs(collection(db, "groups"));
    const groups = [];
    snaps.forEach(doc => groups.push(doc.data().name));

    const adminGroupSelect = document.getElementById('admin-group-filter');
    if (adminGroupSelect) {
      const currentSelectedVal = adminGroupSelect.value || 'ALL';
      let adminGroupHtml = '<option value="ALL">전체 그룹</option>';
      adminGroupHtml += groups.map(g => `<option value="${g}">${g}</option>`).join('');
      adminGroupSelect.innerHTML = adminGroupHtml;
      
      if (groups.includes(currentSelectedVal) || currentSelectedVal === 'ALL') {
        adminGroupSelect.value = currentSelectedVal;
      }
    }

    const regGroupSelect = document.getElementById('reg-group');
    const myGroupSelect = document.getElementById('my-group');
    const deleteGroupSelect = document.getElementById('delete-group-select');
    
    const optionsHtml = groups.map(g => `<option value="${g}">${g}</option>`).join('');
    
    if (regGroupSelect) regGroupSelect.innerHTML = optionsHtml;
    if (myGroupSelect) myGroupSelect.innerHTML = optionsHtml;
    if (deleteGroupSelect) {
      const deletableGroups = groups.filter(g => g !== '[X]');
      deleteGroupSelect.innerHTML = deletableGroups.length > 0 
        ? deletableGroups.map(g => `<option value="${g}">${g}</option>`).join('')
        : '<option value="">삭제 가능한 그룹 없음</option>';
    }
  } catch (err) {
    console.error("그룹 로드 오류:", err);
  }
}

async function loadAdminUserDropdown() {
  const groupSelect = document.getElementById('admin-group-filter');
  const userSelect = document.getElementById('admin-user-filter');
  if (!userSelect) return;

  try {
    if (currentUser.role === 'admin') {
      groupSelect?.classList.remove('hidden');
    } else {
      groupSelect?.classList.add('hidden');
    }

    const selectedGroup = (currentUser.role === 'admin' && groupSelect) ? groupSelect.value : currentUser.group;

    let q;
    if (currentUser.role === 'admin' && selectedGroup === 'ALL') {
      q = query(collection(db, "users"));
    } else {
      q = query(collection(db, "users"), where("group", "==", selectedGroup));
    }

    const snaps = await getDocs(q);
    const currentSelectedUser = userSelect.value || 'WORKING_ONLY';

    let html = '<option value="WORKING_ONLY">💼 [근무자 보기]</option>';
    html += '<option value="ALL">전체 휴가 보기</option>';
    
    snaps.forEach(docSnap => {
      const u = docSnap.data();
      html += `<option value="${docSnap.id}">${u.name} (${docSnap.id})</option>`;
    });

    userSelect.innerHTML = html;
    userSelect.value = currentSelectedUser;
  } catch (err) {
    console.error("사용자 드롭다운 로드 실패:", err);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const phone = document.getElementById('reg-phone').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const job = document.getElementById('reg-job').value;
  const group = document.getElementById('reg-group').value;

  try {
    const userRef = doc(db, "users", phone);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      alert('이미 등록된 전화번호입니다.');
      return;
    }

    await setDoc(userRef, {
      phone, name, password, job, group, role: 'user'
    });

    alert('회원가입이 완료되었습니다! 로그인해 주세요.');
    closeModal('register-modal');
    openModal('login-modal');
  } catch (err) {
    alert('회원가입 실패: ' + err.message);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const id = document.getElementById('login-id').value.trim();
  const password = document.getElementById('login-password').value.trim();

  try {
    const userRef = doc(db, "users", id);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists() || userSnap.data().password !== password) {
      alert('아이디(전화번호) 또는 비밀번호가 올바르지 않습니다.');
      return;
    }

    currentUser = userSnap.data();
    currentUser.id = id;

    localStorage.setItem('vacation_user', JSON.stringify(currentUser));

    await updateUIForLoggedInUser();
    closeModal('login-modal');
    alert(`${currentUser.name}님 환영합니다!`);
  } catch (err) {
    alert('로그인 오류가 발생했습니다.');
  }
}

async function resetPasswordOnLogin() {
  const phone = prompt("가입한 전화번호(- 제외)를 입력하세요:");
  if (!phone) return;

  const name = prompt("가입한 이름을 입력하세요:");
  if (!name) return;

  try {
    const userRef = doc(db, "users", phone.trim());
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists() || userSnap.data().name !== name.trim()) {
      alert("일치하는 회원 정보를 찾을 수 없습니다.");
      return;
    }

    await updateDoc(userRef, { password: phone.trim() });
    alert(`비밀번호가 초기화되었습니다.\n초기화된 비밀번호: ${phone.trim()}`);
  } catch (err) {
    alert("초기화 실패: " + err.message);
  }
}

async function updateUIForLoggedInUser() {
  document.getElementById('auth-buttons').classList.add('hidden');
  document.getElementById('user-menu').classList.remove('hidden');
  document.getElementById('user-info-text').innerText = `${currentUser.name} (${currentUser.group} / ${currentUser.job})`;

  const isManagerOrAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';

  if (isManagerOrAdmin) {
    document.getElementById('btn-open-admin').classList.remove('hidden');
    document.getElementById('admin-filter-container').classList.remove('hidden');
    document.getElementById('user-filter-container').classList.add('hidden');
    
    await loadGroupDropdowns();
    await loadAdminUserDropdown();
  } else {
    document.getElementById('btn-open-admin').classList.add('hidden');
    document.getElementById('admin-filter-container').classList.add('hidden');
    document.getElementById('user-filter-container').classList.remove('hidden');
  }

  if (calendar) calendar.refetchEvents();
}

function logout() {
  currentUser = null;
  localStorage.removeItem('vacation_user');
  document.getElementById('auth-buttons').classList.remove('hidden');
  document.getElementById('user-menu').classList.add('hidden');
  document.getElementById('user-filter-container').classList.add('hidden');
  document.getElementById('admin-filter-container').classList.add('hidden');
  if (calendar) calendar.refetchEvents();
  alert('로그아웃 되었습니다.');
}

async function applyVacation() {
  if (!selectedDateStr || !currentUser) return;

  const docId = `${currentUser.id}_${selectedDateStr}`;
  const vacRef = doc(db, "vacations", docId);

  try {
    const vacSnap = await getDoc(vacRef);
    if (vacSnap.exists()) {
      alert('이미 해당 날짜에 휴가가 등록되어 있습니다.');
      return;
    }

    await setDoc(vacRef, {
      userId: currentUser.id,
      userName: currentUser.name,
      job: currentUser.job,
      group: currentUser.group,
      date: selectedDateStr
    });

    alert(`${selectedDateStr} 휴가가 등록되었습니다.`);
    closeModal('vacation-modal');
    calendar.refetchEvents();
  } catch (err) {
    alert('휴가 등록 실패: ' + err.message);
  }
}

async function cancelVacation() {
  if (!targetVacationDocId || !currentUser) return;

  const vacRef = doc(db, "vacations", targetVacationDocId);

  try {
    const vacSnap = await getDoc(vacRef);
    if (!vacSnap.exists()) {
      alert('취소할 휴가 정보를 찾을 수 없습니다.');
      return;
    }

    const vacData = vacSnap.data();
    const isManagerOrAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
    const isMyVacation = vacData.userId === currentUser.id;

    if (!isMyVacation && !isManagerOrAdmin) {
      alert('다른 사용자의 휴가를 취소할 권한이 없습니다.');
      return;
    }

    if (confirm(`[${vacData.userName}] 님의 ${vacData.date} 휴가를 취소하시겠습니까?`)) {
      await deleteDoc(vacRef);
      alert('휴가가 성공적으로 취소되었습니다.');
      closeModal('vacation-modal');
      calendar.refetchEvents();
    }
  } catch (err) {
    alert('휴가 취소 실패: ' + err.message);
  }
}

function openMyPage() {
  if (!currentUser) return;
  document.getElementById('my-name').value = currentUser.name;
  document.getElementById('my-job').value = currentUser.job;
  document.getElementById('my-group').value = currentUser.group;
  document.getElementById('my-password').value = '';
  openModal('mypage-modal');
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  const newJob = document.getElementById('my-job').value;
  const newGroup = document.getElementById('my-group').value;
  const newPassword = document.getElementById('my-password').value.trim();

  const updateData = { job: newJob, group: newGroup };
  if (newPassword) updateData.password = newPassword;

  try {
    await updateDoc(doc(db, "users", currentUser.id), updateData);
    await updateVacationsJobAndGroup(currentUser.id, newJob, newGroup);

    currentUser.job = newJob;
    currentUser.group = newGroup;
    if (newPassword) currentUser.password = newPassword;

    localStorage.setItem('vacation_user', JSON.stringify(currentUser));

    alert('정보가 수정되었습니다.');
    await updateUIForLoggedInUser();
    closeModal('mypage-modal');
    calendar.refetchEvents();
  } catch (err) {
    alert('수정 실패: ' + err.message);
  }
}

async function resetMyPasswordToPhone() {
  if (currentUser.id === 'admin') {
    alert('admin 계정은 이 기능을 사용할 수 없습니다.');
    return;
  }
  if (confirm(`비밀번호를 핸드폰 번호(${currentUser.phone})로 초기화하시겠습니까?`)) {
    try {
      await updateDoc(doc(db, "users", currentUser.id), { password: currentUser.phone });
      currentUser.password = currentUser.phone;
      localStorage.setItem('vacation_user', JSON.stringify(currentUser));
      alert('비밀번호가 핸드폰 번호로 초기화되었습니다.');
      closeModal('mypage-modal');
    } catch (err) {
      alert('초기화 실패: ' + err.message);
    }
  }
}

async function openAdminModal() {
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) return;

  if (currentUser.role === 'admin') {
    document.getElementById('admin-group-create-sec').classList.remove('hidden');
  } else {
    document.getElementById('admin-group-create-sec').classList.add('hidden');
  }

  await loadAdminUserTable();
  await loadGroupDropdowns();
  openModal('admin-modal');
}

async function createGroup() {
  const groupName = document.getElementById('new-group-name').value.trim();
  if (!groupName) {
    alert('생성할 그룹명을 입력하세요.');
    return;
  }

  try {
    await setDoc(doc(db, "groups", groupName), { name: groupName });
    alert(`[${groupName}] 그룹이 생성되었습니다.`);
    document.getElementById('new-group-name').value = '';
    await loadGroupDropdowns();
  } catch (err) {
    alert('그룹 생성 실패: ' + err.message);
  }
}

async function deleteGroup() {
  const targetGroup = document.getElementById('delete-group-select').value;

  if (!targetGroup) {
    alert('삭제할 그룹을 선택해주세요.');
    return;
  }

  if (targetGroup === '[X]') {
    alert('[X] 그룹은 기본 이동 그룹이므로 삭제할 수 없습니다.');
    return;
  }

  if (!confirm(`정말로 [${targetGroup}] 그룹을 삭제하시겠습니까?\n해당 그룹 소속 사용자는 모두 '[X]' 그룹으로 변경됩니다.`)) {
    return;
  }

  try {
    const batch = writeBatch(db);

    const xGroupRef = doc(db, "groups", "[X]");
    const xGroupSnap = await getDoc(xGroupRef);
    if (!xGroupSnap.exists()) {
      batch.set(xGroupRef, { name: "[X]" });
    }

    const usersQ = query(collection(db, "users"), where("group", "==", targetGroup));
    const userSnaps = await getDocs(usersQ);
    let affectedUserCount = 0;

    userSnaps.forEach(uDoc => {
      batch.update(uDoc.ref, { group: "[X]" });
      affectedUserCount++;
    });

    const vacQ = query(collection(db, "vacations"), where("group", "==", targetGroup));
    const vacSnaps = await getDocs(vacQ);

    vacSnaps.forEach(vDoc => {
      batch.update(vDoc.ref, { group: "[X]" });
    });

    const targetGroupRef = doc(db, "groups", targetGroup);
    batch.delete(targetGroupRef);

    await batch.commit();

    if (currentUser.group === targetGroup) {
      currentUser.group = "[X]";
      localStorage.setItem('vacation_user', JSON.stringify(currentUser));
      updateUIForLoggedInUser();
    }

    alert(`[${targetGroup}] 그룹이 삭제되었습니다.\n총 ${affectedUserCount}명의 사용자가 '[X]' 그룹으로 이동되었습니다.`);

    await loadGroupDropdowns();
    await loadAdminUserTable();
    await loadAdminUserDropdown();
    if (calendar) calendar.refetchEvents();

  } catch (err) {
    console.error("그룹 삭제 오류:", err);
    alert('그룹 삭제 실패: ' + err.message);
  }
}

// 사용자 목록 테이블 불러오기 (이름만 표시되도록 수정됨)
async function loadAdminUserTable() {
  const tbody = document.getElementById('admin-user-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4">데이터 로딩 중...</td></tr>';

  try {
    let q;
    if (currentUser.role === 'admin') {
      q = query(collection(db, "users"));
    } else {
      q = query(collection(db, "users"), where("group", "==", currentUser.group));
    }

    const querySnapshot = await getDocs(q);
    const groupsSnap = await getDocs(collection(db, "groups"));
    const groupOptions = [];
    groupsSnap.forEach(g => groupOptions.push(g.data().name));

    tbody.innerHTML = '';

    querySnapshot.forEach((docSnap) => {
      const u = docSnap.data();
      const userId = docSnap.id;

      const row = document.createElement('tr');
      row.className = "border-b hover:bg-gray-50 dark:hover:bg-gray-700";

      // 이름만 출력하도록 `${u.name}` 적용
      row.innerHTML = `
        <td class="p-2 border font-medium">${u.name}</td>
        <td class="p-2 border">${u.phone || '-'}</td>
        <td class="p-2 border">
          <select id="job-${userId}" class="border rounded p-1 text-xs dark:bg-gray-800 dark:text-white">
            <option value="관리자" ${u.job === '관리자' ? 'selected' : ''}>관리자 (보라색)</option>
            <option value="장비" ${u.job === '장비' ? 'selected' : ''}>장비 (녹색)</option>
            <option value="피킹" ${u.job === '피킹' ? 'selected' : ''}>피킹 (파란색)</option>
          </select>
        </td>
        <td class="p-2 border">
          <select id="group-${userId}" ${currentUser.role !== 'admin' ? 'disabled' : ''} class="border rounded p-1 text-xs dark:bg-gray-800 dark:text-white">
            ${groupOptions.map(g => `<option value="${g}" ${u.group === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
        </td>
        <td class="p-2 border">
          <select id="role-${userId}" ${currentUser.role !== 'admin' ? 'disabled' : ''} class="border rounded p-1 text-xs dark:bg-gray-800 dark:text-white">
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>일반</option>
            <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>그룹 관리자</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>최고 관리자</option>
          </select>
        </td>
        <td class="p-2 border text-center space-x-1">
          <button data-action="save" data-id="${userId}" class="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">저장</button>
          <button data-action="reset" data-id="${userId}" data-phone="${u.phone}" class="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">PW초기화</button>
          <button data-action="delete" data-id="${userId}" class="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">삭제</button>
        </td>
      `;
      tbody.appendChild(row);
    });

    tbody.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        const userId = e.target.getAttribute('data-id');
        const phone = e.target.getAttribute('data-phone');

        if (action === 'save') updateUserByAdmin(userId);
        if (action === 'reset') resetUserPwByAdmin(userId, phone);
        if (action === 'delete') deleteUserByAdmin(userId);
      });
    });

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-red-500">목록을 불러오는 중 오류가 발생했습니다.</td></tr>';
  }
}

async function updateVacationsJobAndGroup(targetUserId, newJob, newGroup) {
  const q = query(collection(db, "vacations"), where("userId", "==", targetUserId));
  const snaps = await getDocs(q);

  const batch = writeBatch(db);
  snaps.forEach(docSnap => {
    batch.update(docSnap.ref, { job: newJob, group: newGroup });
  });
  await batch.commit();
}

async function updateUserByAdmin(targetUserId) {
  const newJob = document.getElementById(`job-${targetUserId}`).value;
  const newGroup = document.getElementById(`group-${targetUserId}`).value;
  const newRole = document.getElementById(`role-${targetUserId}`).value;

  try {
    await updateDoc(doc(db, "users", targetUserId), {
      job: newJob,
      group: newGroup,
      role: newRole
    });

    await updateVacationsJobAndGroup(targetUserId, newJob, newGroup);

    alert('사용자 정보 및 휴가 직무 정보가 변경되었습니다.');

    if (currentUser.id === targetUserId) {
      currentUser.job = newJob;
      currentUser.group = newGroup;
      currentUser.role = newRole;
      localStorage.setItem('vacation_user', JSON.stringify(currentUser));
      await updateUIForLoggedInUser();
    }
    calendar.refetchEvents();
  } catch (err) {
    alert('수정 실패: ' + err.message);
  }
}

async function resetUserPwByAdmin(targetUserId, userPhone) {
  if (targetUserId === 'admin') {
    alert('admin 계정의 비밀번호는 여기서 초기화할 수 없습니다.');
    return;
  }
  const defaultPw = userPhone && userPhone !== '-' ? userPhone : '1234';
  if (confirm(`[${targetUserId}] 이용자의 비밀번호를 '${defaultPw}'(으)로 초기화하시겠습니까?`)) {
    try {
      await updateDoc(doc(db, "users", targetUserId), { password: defaultPw });
      alert(`비밀번호가 '${defaultPw}'(으)로 초기화되었습니다.`);
    } catch (err) {
      alert('초기화 실패: ' + err.message);
    }
  }
}

async function deleteUserByAdmin(targetUserId) {
  if (targetUserId === 'admin') {
    alert('admin 최고 관리자 계정은 삭제할 수 없습니다.');
    return;
  }
  if (confirm(`정말로 [${targetUserId}] 이용자를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) {
    try {
      await deleteDoc(doc(db, "users", targetUserId));
      alert('이용자가 삭제되었습니다.');
      await loadAdminUserTable();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }
}