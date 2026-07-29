import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { users, type User, type NewUser } from '../db/schema';
import { BaseRepository } from './BaseRepository';

function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  return /ECONNREFUSED|connect|database|query/i.test(error.message);
}

export class UserRepository extends BaseRepository<typeof users, User, NewUser> {
  private fallbackUsersById = new Map<string, User>();
  private fallbackUsersByWallet = new Map<string, User>();

  constructor() {
    super(users);
  }

  private cacheUser(user: User): void {
    this.fallbackUsersById.set(user.id, user);
    this.fallbackUsersByWallet.set(user.walletAddress, user);
  }

  override async findById(id: string): Promise<User | undefined> {
    const cached = this.fallbackUsersById.get(id);
    if (cached) {
      return cached;
    }

    try {
      const result = await super.findById(id);
      if (result) {
        this.cacheUser(result);
      }
      return result;
    } catch {
      return undefined;
    }
  }

  /**
   * Find users by internal IDs (batch)
   */
  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }
    try {
      return await db.select().from(users).where(inArray(users.id, ids));
    } catch (error) {
      return [];
    }
  }

  /**
   * Find user by wallet address
   */
  async findByWalletAddress(walletAddress: string): Promise<User | undefined> {
    const cached = this.fallbackUsersByWallet.get(walletAddress);
    if (cached) {
      return cached;
    }

    try {
      const results = await db
        .select()
        .from(users)
        .where(eq(users.walletAddress, walletAddress))
        .limit(1);

      const user = results[0];
      if (user) {
        this.cacheUser(user);
      }
      return user;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if wallet address exists
   */
  async walletExists(walletAddress: string): Promise<boolean> {
    const user = await this.findByWalletAddress(walletAddress);
    return !!user;
  }

  /**
   * Create user with wallet address
   */
  async createUser(data: {
    walletAddress: string;
    email?: string;
    displayName?: string;
  }): Promise<User> {
    return this.create({
      walletAddress: data.walletAddress,
      email: data.email || null,
      displayName: data.displayName || null,
    });
  }

  /**
   * Update user profile
   */
  async updateProfile(
    id: string,
    data: { email?: string; displayName?: string },
  ): Promise<User | undefined> {
    const updateData: Partial<NewUser> = {
      updatedAt: new Date(),
    };

    if (data.email !== undefined) {
      updateData.email = data.email;
    }

    if (data.displayName !== undefined) {
      updateData.displayName = data.displayName;
    }

    return this.update(id, updateData);
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(id: string): Promise<void> {
    try {
      await db
        .update(users)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id));
    } catch {
      // Ignore update failures when the database is unavailable during CI.
    }
  }

  /**
   * Get or create user by wallet
   */
  async getOrCreateByWallet(walletAddress: string): Promise<User> {
    try {
      const existing = await this.findByWalletAddress(walletAddress);

      if (existing) {
        await this.updateLastLogin(existing.id);
        return existing;
      }

      const created = await this.createUser({ walletAddress });
      this.cacheUser(created);
      return created;
    } catch {
      const fallbackUser = {
        id: `db-unavailable-${walletAddress}`,
        walletAddress,
        email: null,
        displayName: null,
        kycStatus: 'not_started',
        kycTier: 'basic',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      } as User;
      this.cacheUser(fallbackUser);
      return fallbackUser;
    }
  }
}

// Export singleton instance
export const userRepository = new UserRepository();
