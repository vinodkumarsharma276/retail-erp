// import { prisma } from '../../config/database.js';

/**
 * Register a push notification token for a user.
 * Stores the Expo push token associated with the user and device.
 */
export async function registerPushToken(userId: string, token: string, deviceId?: string) {
  // Stub — will connect to push_tokens table and Expo push service later
  return {
    success: true,
    message: 'Push token registered (stub)',
    userId,
    token,
    deviceId: deviceId ?? null,
  };
}

/**
 * Get notifications for a user.
 */
export async function getUserNotifications(userId: string, page = 1, limit = 20) {
  // Stub — will query notifications table later
  return {
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
    },
  };
}

/**
 * Mark a notification as read.
 */
export async function markAsRead(notificationId: string, userId: string) {
  // Stub — will update notification record later
  return {
    success: true,
    message: 'Notification marked as read (stub)',
    notificationId,
  };
}

/**
 * Send a push notification (internal helper — not exposed as route).
 * Will integrate with Expo Push API in the future.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  // Stub — will call Expo Push API later
  console.log(`[Notification Stub] To: ${userId}, Title: ${title}, Body: ${body}`);
  return { success: true, message: 'Notification sent (stub)' };
}
