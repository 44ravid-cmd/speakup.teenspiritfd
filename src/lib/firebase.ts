import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore, collection, doc, setDoc, getDoc, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

// Connection state tracking
let isOnline = true;
const connectionListeners: ((online: boolean) => void)[] = [];

export function onConnectionStateChange(callback: (online: boolean) => void) {
  connectionListeners.push(callback);
  return () => {
    const index = connectionListeners.indexOf(callback);
    if (index > -1) connectionListeners.splice(index, 1);
  };
}

function updateConnectionState(online: boolean) {
  if (isOnline === online) return;
  isOnline = online;
  connectionListeners.forEach(cb => cb(online));
}

// Validate Connection to Firestore
async function testConnection() {
  try {
    // Attempt to fetch a non-existent doc from server to verify connection
    await getDocFromServer(doc(db, 'system', 'connection-test'));
    console.log("Firestore connection verified.");
    updateConnectionState(true);
  } catch (error: any) {
    if (error?.code === 'unavailable' || (error instanceof Error && error.message.includes('the client is offline'))) {
      console.warn("Firestore appears to be offline or unreachable. Entering retry loop...");
      updateConnectionState(false);
      // Retry in 5 seconds
      setTimeout(testConnection, 5000);
    } else {
      console.error("Firestore connection error:", error);
    }
  }
}
testConnection();

export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export { collection, doc, setDoc, getDoc, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp };
