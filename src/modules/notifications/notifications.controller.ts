import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { QueryNotificationsDto, MarkAsReadDto } from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags('Notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications
   * Get user's notifications
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getNotifications(
    @Query() query: QueryNotificationsDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.notificationsService.getNotifications(req.user.id, query);
    return {
      success: true,
      data: result.notifications,
      meta: {
        total: result.total,
        unreadCount: result.unreadCount,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }

  /**
   * GET /notifications/unread-count
   * Get unread notification count
   */
  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async getUnreadCount(@Request() req: RequestWithUser): Promise<any> {
    const count = await this.notificationsService.getUnreadCount(req.user.id);
    return {
      success: true,
      data: { unreadCount: count },
    };
  }

  /**
   * GET /notifications/:notificationId
   * Get single notification
   */
  @Get(':notificationId')
  @HttpCode(HttpStatus.OK)
  async getNotification(
    @Param('notificationId') notificationId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const notification = await this.notificationsService.getNotificationById(
      notificationId,
      req.user.id,
    );
    return {
      success: true,
      data: notification,
    };
  }

  /**
   * POST /notifications/read
   * Mark notifications as read
   */
  @Post('read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Body() dto: MarkAsReadDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.notificationsService.markAsRead(req.user.id, dto);
    return {
      success: true,
      message: `${result.markedCount} notification(s) marked as read`,
      data: { markedCount: result.markedCount },
    };
  }

  /**
   * POST /notifications/:notificationId/read
   * Mark single notification as read
   */
  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  async markOneAsRead(
    @Param('notificationId') notificationId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.notificationsService.markOneAsRead(req.user.id, notificationId);
    return {
      success: true,
      message: 'Notification marked as read',
    };
  }

  /**
   * DELETE /notifications/:notificationId
   * Delete a notification
   */
  @Delete(':notificationId')
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @Param('notificationId') notificationId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.notificationsService.deleteNotification(req.user.id, notificationId);
    return {
      success: true,
      message: 'Notification deleted successfully',
    };
  }

  /**
   * DELETE /notifications/read/all
   * Delete all read notifications
   */
  @Delete('read/all')
  @HttpCode(HttpStatus.OK)
  async deleteAllRead(@Request() req: RequestWithUser): Promise<any> {
    const result = await this.notificationsService.deleteAllRead(req.user.id);
    return {
      success: true,
      message: `${result.deletedCount} read notification(s) deleted`,
      data: { deletedCount: result.deletedCount },
    };
  }
}
