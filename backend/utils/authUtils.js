/**
 * Authentication Utilities
 * Functions for validating user authentication status
 */

/**
 * Validate that a user is still active in Supabase Auth
 * Use this to check if a user still exists and is not banned before processing requests
 * 
 * @param {Object} supabase - Supabase client instance (with service_role key)
 * @param {string} userId - The user ID to validate
 * @returns {Promise<{valid: boolean, user?: Object, error?: string}>}
 */
export async function validateActiveUser(supabase, userId) {
    if (!supabase) {
        console.warn('[Auth] Supabase not configured, skipping user validation');
        return { valid: true }; // Allow if Supabase not configured (local dev)
    }

    if (!userId) {
        return { valid: false, error: 'User ID is required' };
    }

    try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);

        if (error) {
            console.error('[Auth] Error fetching user:', error.message);
            return { valid: false, error: 'Failed to validate user' };
        }

        if (!data?.user) {
            console.log(`[Auth] User ${userId} not found in auth system`);
            return { valid: false, error: 'User not found or has been removed' };
        }

        // Check if user is banned
        const user = data.user;
        if (user.banned_until) {
            const bannedUntil = new Date(user.banned_until);
            if (bannedUntil > new Date()) {
                console.log(`[Auth] User ${userId} is banned until ${bannedUntil.toISOString()}`);
                return { valid: false, error: 'User account is currently suspended' };
            }
        }

        return { valid: true, user };
    } catch (err) {
        console.error('[Auth] Unexpected error validating user:', err);
        return { valid: false, error: 'Failed to validate user' };
    }
}
